import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../../database/db.service';
import { AuthUser } from '../../common/auth';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { scopeEmployees, Where } from '../../common/sql';
import { isWorkingDay } from '../../domain/daily-summary';
import { AttendanceType, evaluatePunch, TYPE_LABELS } from '../../domain/punch-rules';
import { isoWeekday, localParts, zonedToUtc } from '../../domain/time';
import { AuditService } from '../audit/audit.service';
import { CompanyContextService } from '../core/company-context.service';
import { TelegramService } from '../core/telegram.service';
import { adminMessages, REVIEW, tgMessages, REVIEW_CORRECTION } from '../core/telegram-messages';

export interface CorrectionInput {
  employeeId?: string;
  workDate: string;
  attendanceType: AttendanceType;
  time: string; // HH:MM local
  reason: string;
}

function mapCorrection(r: any, tz: string) {
  const t = (d: any) => (d ? localParts(new Date(d), tz).time : null);
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.employee_name,
    department: r.department_name,
    workDate: r.work_date,
    type: r.attendance_type,
    typeLabel: TYPE_LABELS[r.attendance_type as AttendanceType],
    currentTime: t(r.current_time_at),
    requestedTime: t(r.requested_time),
    reason: r.reason,
    status: r.status,
    requestedBy: r.requested_by_name,
    reviewedBy: r.reviewed_by_name,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
    createdAt: r.created_at,
  };
}

const SELECT = `
  SELECT c.*, e.employee_code, e.name AS employee_name, d.name AS department_name, ru.name AS requested_by_name, vu.name AS reviewed_by_name
    FROM attendance_corrections c
    JOIN employees e ON e.id = c.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN users ru ON ru.id = c.requested_by
    LEFT JOIN users vu ON vu.id = c.reviewed_by`;

/**
 * Attendance corrections ("forgot to scan"). Employees and staff request; HR/admin approve or reject.
 * Approval writes a 'correction' record (replacing an existing scan of that type) and every step is audited.
 */
@Injectable()
export class CorrectionsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly ctx: CompanyContextService, private readonly telegram: TelegramService) {}

  async list(user: AuthUser, q: { status?: string; employeeId?: string; mine?: boolean }) {
    const companyId = user.companyId!;
    const { timezone } = await this.ctx.get(companyId);
    const w = new Where().add('c.company_id = ?', companyId);
    if (q.mine || user.role === 'employee') w.add('c.employee_id = ?', user.employeeId);
    else scopeEmployees(w, user);
    if (q.status && ['pending', 'approved', 'rejected', 'cancelled'].includes(q.status)) w.add('c.status = ?', q.status);
    w.addIf(q.employeeId, 'c.employee_id = ?');
    const rows = await this.db.query(`${SELECT} ${w} ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 500`, w.params);
    return rows.map((r) => mapCorrection(r, timezone));
  }

  async request(user: AuthUser, input: CorrectionInput, ip: string) {
    const companyId = user.companyId!;
    const company = await this.ctx.get(companyId);
    const employeeId = user.role === 'employee' ? user.employeeId : input.employeeId ?? user.employeeId;
    if (!employeeId) throw badRequest('Choose an employee.', 'EMPLOYEE_REQUIRED');
    if (user.role === 'employee' && input.employeeId && input.employeeId !== user.employeeId) throw forbidden();
    if (user.role === 'employee' && !company.rules.allowEmployeeCorrections) throw forbidden('Correction requests are turned off. Contact HR.', 'CORRECTIONS_DISABLED');
    await this.checkEmployee(user, employeeId);

    const today = this.ctx.now(company.timezone).date;
    if (input.workDate > today) throw badRequest('You cannot request a correction for a future date.', 'FUTURE_DATE');
    const requested = zonedToUtc(input.workDate, input.time, company.timezone);
    if (requested.getTime() > Date.now()) throw badRequest('That time is in the future.', 'FUTURE_TIME');
    const current = await this.db.maybeOne(
      `SELECT scan_time FROM attendance WHERE employee_id = $1 AND work_date = $2 AND attendance_type = $3 AND NOT is_void ORDER BY scan_time LIMIT 1`,
      [employeeId, input.workDate, input.attendanceType],
    );
    const dup = await this.db.maybeOne(
      `SELECT 1 FROM attendance_corrections WHERE employee_id = $1 AND work_date = $2 AND attendance_type = $3 AND status = 'pending'`,
      [employeeId, input.workDate, input.attendanceType],
    );
    if (dup) throw badRequest('There is already a pending request for that day and type.', 'DUPLICATE_REQUEST');

    const r = await this.db.one(
      `INSERT INTO attendance_corrections (company_id, employee_id, work_date, attendance_type, current_time_at, requested_time, reason, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [companyId, employeeId, input.workDate, input.attendanceType, current?.scan_time ?? null, requested, input.reason.trim(), user.id],
    );
    await this.audit.log({ companyId, userId: user.id, action: 'request', module: 'attendance_corrections', recordId: r.id, newValue: { employeeId, ...input }, ip });
    const out = await this.get(user, r.id);
    if (user.role === 'employee') {
      const emp = await this.db.one('SELECT name, employee_code, department_id, branch_id FROM employees WHERE id = $1', [employeeId]);
      const msg = adminMessages.newCorrection(emp.name, emp.employee_code, input.workDate, input.attendanceType, out.requestedTime, input.reason.trim());
      this.telegram.alertAdmins(companyId, 'requests', emp.department_id, msg, [REVIEW]);
      this.telegram.notifyGroups(companyId, 'correction', emp.branch_id, msg, REVIEW_CORRECTION);
    }
    return out;
  }

  /** HR enters a correction directly: requested and approved in one step (still audited). */
  async manual(user: AuthUser, input: CorrectionInput, ip: string) {
    await this.ctx.assertPayrollOpen(user.companyId!, [input.workDate]);
    const created = await this.request(user, input, ip);
    return this.review(user, created.id, 'approve', 'Entered by HR', ip);
  }

  async get(user: AuthUser, id: string) {
    const { timezone } = await this.ctx.get(user.companyId!);
    const w = new Where().add('c.company_id = ?', user.companyId).add('c.id = ?', id);
    if (user.role === 'employee') w.add('c.employee_id = ?', user.employeeId);
    else scopeEmployees(w, user);
    const r = await this.db.maybeOne(`${SELECT} ${w}`, w.params);
    if (!r) throw notFound('Correction request');
    return mapCorrection(r, timezone);
  }

  private async checkEmployee(user: AuthUser, employeeId: string, tx: Queryable = this.db) {
    const w = new Where().add('e.company_id = ?', user.companyId).add('e.id = ?', employeeId);
    if (user.role !== 'employee') scopeEmployees(w, user);
    const e = await tx.maybeOne(`SELECT e.id, e.schedule_id FROM employees e ${w}`, w.params);
    if (!e) throw notFound('Employee');
    return e;
  }

  async review(user: AuthUser, id: string, decision: 'approve' | 'reject', note: string | undefined, ip: string) {
    const companyId = user.companyId!;
    const company = await this.ctx.get(companyId);
    await this.db.tx(async (tx) => {
      const c = await tx.maybeOne(`SELECT * FROM attendance_corrections WHERE company_id = $1 AND id = $2 FOR UPDATE`, [companyId, id]);
      if (!c) throw notFound('Correction request');
      if (c.status !== 'pending') throw badRequest('This request was already handled.', 'ALREADY_REVIEWED');
      if (decision === 'approve') await this.ctx.assertPayrollOpen(companyId, [c.work_date], tx);
      const emp = await this.checkEmployee(user, c.employee_id, tx);

      let attendanceId: string | null = null;
      if (decision === 'approve') {
        const requested = new Date(c.requested_time);
        const local = localParts(requested, company.timezone);
        const schedule = await this.ctx.scheduleFor(companyId, emp.schedule_id, tx);
        const holiday = await this.ctx.holidayName(companyId, c.work_date, tx);
        const ev = evaluatePunch(c.attendance_type, local.minutes, schedule, company.rules, isWorkingDay({ schedule, weekday: isoWeekday(c.work_date), holiday }));
        // The corrected time replaces any existing scan of the same type that day.
        const replaced = await tx.query(
          `UPDATE attendance SET is_void = true, void_reason = $4, voided_by = $5, voided_at = now()
            WHERE employee_id = $1 AND work_date = $2 AND attendance_type = $3 AND NOT is_void RETURNING id, scan_time`,
          [c.employee_id, c.work_date, c.attendance_type, `Replaced by correction ${id}`, user.id],
        );
        const rec = await tx.one(
          `INSERT INTO attendance (company_id, employee_id, attendance_type, scan_time, work_date, source, status, late_minutes, early_minutes, overtime_minutes, remarks, created_by)
           VALUES ($1, $2, $3, $4, $5, 'correction', $6, $7, $8, $9, $10, $11) RETURNING id`,
          [companyId, c.employee_id, c.attendance_type, requested, c.work_date, ev.status, ev.lateMinutes, ev.earlyMinutes, ev.overtimeMinutes, `Correction: ${c.reason}`.slice(0, 500), user.id],
        );
        attendanceId = rec.id;
        await this.audit.log({
          companyId, userId: user.id, action: 'correct', module: 'attendance', recordId: rec.id,
          oldValue: { replaced }, newValue: { type: c.attendance_type, scanTime: requested, workDate: c.work_date, status: ev.status, correctionId: id }, ip,
        }, tx);
      }
      await tx.query(
        `UPDATE attendance_corrections SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, attendance_id = $5 WHERE id = $1`,
        [id, decision === 'approve' ? 'approved' : 'rejected', user.id, note?.trim() || null, attendanceId],
      );
      await this.audit.log({ companyId, userId: user.id, action: decision, module: 'attendance_corrections', recordId: id, oldValue: { status: 'pending' }, newValue: { status: decision === 'approve' ? 'approved' : 'rejected', note }, ip }, tx);
    });
    const out = await this.get(user, id);
    // HR entering a correction directly does not need a message about it.
    if (note !== 'Entered by HR') this.telegram.notifyEmployee(out.employeeId, tgMessages.correction(decision, out.workDate, out.type, note));
    return out;
  }

  async cancel(user: AuthUser, id: string, ip: string) {
    const r = await this.db.maybeOne(
      `UPDATE attendance_corrections SET status = 'cancelled' WHERE company_id = $1 AND id = $2 AND requested_by = $3 AND status = 'pending' RETURNING id`,
      [user.companyId, id, user.id],
    );
    if (!r) throw badRequest('Only your own pending requests can be cancelled.', 'CANNOT_CANCEL');
    await this.audit.log({ companyId: user.companyId, userId: user.id, action: 'cancel', module: 'attendance_corrections', recordId: id, ip });
    return { ok: true };
  }
}

