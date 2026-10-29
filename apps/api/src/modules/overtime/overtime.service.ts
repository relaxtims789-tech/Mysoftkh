import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../../database/db.service';
import { AuthUser, requireEmployee } from '../../common/auth';
import { badRequest, forbidden } from '../../common/errors';
import { DaySummary } from '../../domain/daily-summary';
import { DEFAULT_OT_POLICY, hourlyRate, OtDayPay, OtDayType, OtPolicy, otPayForDay, OtTotals, sumOt } from '../../domain/overtime-pay';
import { localParts } from '../../domain/time';
import { AuditService, diff } from '../audit/audit.service';
import { AttendanceSummaryService, SummaryEmployee } from '../attendance/summary.service';
import { CompanyContextService } from '../core/company-context.service';
import { TelegramService } from '../core/telegram.service';
import { tgMessages } from '../core/telegram-messages';

export type OtStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface OtDay {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  branch: string | null;
  workDate: string;
  dayType: OtDayType;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number;
  /** OT the scans add up to. */
  overtimeMinutes: number;
  /** OT that counts for pay: all of it when approval is off, the approved minutes when on. */
  countedMinutes: number;
  status: OtStatus;
  reason: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  pay: OtDayPay;
  /** Pending days: what the day would pay if all of its overtime were approved. */
  ifApproved: OtDayPay | null;
}

export interface OtEmployeeTotals {
  employee: SummaryEmployee;
  monthlySalary: number | null;
  hourlyRate: number | null;
  days: OtDay[];
  totals: OtTotals;
  pendingMinutes: number;
}

export interface OtFilter {
  departmentId?: string;
  branchId?: string;
  employeeId?: string;
}

export interface PolicyInput {
  requiresApproval?: boolean;
  currency?: string;
  monthlyHours?: number;
  workDay?: { mode: 'multiplier' | 'fixed_hour'; value: number };
  dayOff?: { mode: 'multiplier' | 'fixed_hour' | 'fixed_day'; value: number; minHours?: number };
  holiday?: { mode: 'multiplier' | 'fixed_hour' | 'fixed_day'; value: number; minHours?: number };
}

const canSeePay = (u: AuthUser | null) => !u || u.role !== 'manager';

export function dayTypeOf(d: DaySummary): OtDayType {
  return d.isWorkingDay ? 'work_day' : d.holiday ? 'holiday' : 'day_off';
}

/**
 * Overtime approval and pay. The OT minutes themselves come from the attendance summary (scans + schedule); this
 * service adds the approval decision and turns counted minutes into hours, weighted hours and money.
 */
@Injectable()
export class OvertimeService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ctx: CompanyContextService,
    private readonly summaries: AttendanceSummaryService,
    private readonly telegram: TelegramService,
  ) {}

  async getPolicy(companyId: string, tx: Queryable = this.db): Promise<OtPolicy> {
    const r = await tx.maybeOne('SELECT * FROM overtime_policies WHERE company_id = $1', [companyId]);
    if (!r) return DEFAULT_OT_POLICY;
    return {
      requiresApproval: r.requires_approval,
      currency: r.currency,
      monthlyHours: Number(r.monthly_hours),
      workDay: { mode: r.workday_mode, value: Number(r.workday_value), minHours: 0 },
      dayOff: { mode: r.dayoff_mode, value: Number(r.dayoff_value), minHours: Number(r.dayoff_min_hours) },
      holiday: { mode: r.holiday_mode, value: Number(r.holiday_value), minHours: Number(r.holiday_min_hours) },
    };
  }

  async updatePolicy(companyId: string, input: PolicyInput, actor: AuthUser, ip: string): Promise<OtPolicy> {
    const before = await this.getPolicy(companyId);
    const next: OtPolicy = {
      requiresApproval: input.requiresApproval ?? before.requiresApproval,
      currency: input.currency ?? before.currency,
      monthlyHours: input.monthlyHours ?? before.monthlyHours,
      workDay: input.workDay ? { ...input.workDay, minHours: 0 } : before.workDay,
      dayOff: input.dayOff ? { ...input.dayOff, minHours: input.dayOff.minHours ?? before.dayOff.minHours } : before.dayOff,
      holiday: input.holiday ? { ...input.holiday, minHours: input.holiday.minHours ?? before.holiday.minHours } : before.holiday,
    };
    if ((next.workDay.mode as string) === 'fixed_day') throw badRequest('A normal work day can be paid per hour only.', 'BAD_RULE');
    await this.db.query(
      `INSERT INTO overtime_policies (company_id, requires_approval, currency, monthly_hours, workday_mode, workday_value, dayoff_mode, dayoff_value,
                                      dayoff_min_hours, holiday_mode, holiday_value, holiday_min_hours, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (company_id) DO UPDATE SET requires_approval = $2, currency = $3, monthly_hours = $4, workday_mode = $5, workday_value = $6,
         dayoff_mode = $7, dayoff_value = $8, dayoff_min_hours = $9, holiday_mode = $10, holiday_value = $11, holiday_min_hours = $12, updated_at = now()`,
      [companyId, next.requiresApproval, next.currency, next.monthlyHours, next.workDay.mode, next.workDay.value, next.dayOff.mode, next.dayOff.value,
        next.dayOff.minHours, next.holiday.mode, next.holiday.value, next.holiday.minHours],
    );
    const d = diff(before as any, next as any);
    await this.audit.log({ companyId, userId: actor.id, action: 'update', module: 'overtime_policy', recordId: companyId, oldValue: d.old, newValue: d.new, ip });
    return next;
  }

  /**
   * Every employee-day with overtime in the range, with its approval status and pay, grouped by employee.
   * `user` limits managers to their departments; pass null for company-wide use.
   */
  async compute(companyId: string, from: string, to: string, user: AuthUser | null, filter: OtFilter = {}): Promise<{ policy: OtPolicy; employees: OtEmployeeTotals[] }> {
    const policy = await this.getPolicy(companyId);
    const company = await this.ctx.get(companyId);
    const built = await this.summaries.build(companyId, from, to, user, {
      departmentId: filter.departmentId, branchId: filter.branchId, employeeIds: filter.employeeId ? [filter.employeeId] : undefined,
    });
    const ids = built.employees.map((e) => e.id);
    const [payRows, decisions] = await Promise.all([
      ids.length ? this.db.query('SELECT id, monthly_salary, hourly_rate FROM employees WHERE id = ANY($1::uuid[])', [ids]) : Promise.resolve([]),
      ids.length
        ? this.db.query(
            `SELECT a.*, u.name AS reviewed_by_name FROM overtime_approvals a LEFT JOIN users u ON u.id = a.reviewed_by
              WHERE a.company_id = $1 AND a.work_date BETWEEN $2 AND $3 AND a.employee_id = ANY($4::uuid[])`,
            [companyId, from, to, ids],
          )
        : Promise.resolve([]),
    ]);
    const payBy = new Map(payRows.map((r) => [r.id, r]));
    const decided = new Map(decisions.map((r) => [`${r.employee_id}|${r.work_date}`, r]));
    const t = (d: Date | null) => (d ? localParts(new Date(d), company.timezone).time : null);

    const employees: OtEmployeeTotals[] = [];
    for (const e of built.employees) {
      const p = payBy.get(e.id);
      const pay = { monthlySalary: p?.monthly_salary ?? null, hourlyRate: p?.hourly_rate ?? null };
      const rate = hourlyRate(pay, policy);
      const days: OtDay[] = [];
      let pendingMinutes = 0;
      for (const d of built.days.get(e.id) ?? []) {
        if (d.overtimeMinutes <= 0) continue;
        const row = decided.get(`${e.id}|${d.date}`);
        let status: OtStatus = 'not_required';
        let counted = d.overtimeMinutes;
        if (policy.requiresApproval) {
          status = row?.status ?? 'pending';
          counted = status === 'approved' ? Math.min(row?.approved_minutes ?? d.overtimeMinutes, d.overtimeMinutes) : 0;
          if (status === 'pending') pendingMinutes += d.overtimeMinutes;
        }
        const dayType = dayTypeOf(d);
        days.push({
          employeeId: e.id, employeeCode: e.employeeCode, name: e.name, department: e.department, branch: e.branch, workDate: d.date, dayType,
          checkIn: t(d.checkIn), checkOut: t(d.checkOut), workedMinutes: d.workedMinutes, overtimeMinutes: d.overtimeMinutes, countedMinutes: counted,
          status, reason: row?.reason ?? null, reviewNote: row?.review_note ?? null, reviewedBy: row?.reviewed_by_name ?? null,
          pay: otPayForDay(counted, dayType, policy, rate),
          ifApproved: status === 'pending' ? otPayForDay(d.overtimeMinutes, dayType, policy, rate) : null,
        });
      }
      employees.push({ employee: e, monthlySalary: pay.monthlySalary, hourlyRate: rate, days, totals: sumOt(days), pendingMinutes });
    }
    if (!canSeePay(user)) {
      for (const x of employees) {
        x.monthlySalary = null;
        x.hourlyRate = null;
        x.totals.amount = null;
        for (const d of x.days) {
          d.pay.amount = null;
          if (d.ifApproved) d.ifApproved.amount = null;
        }
      }
    }
    return { policy, employees };
  }

  /** Flat list for the approval screen. */
  async days(user: AuthUser, from: string, to: string, status: string | undefined, filter: OtFilter) {
    const { policy, employees } = await this.compute(user.companyId!, from, to, user, filter);
    let rows = employees.flatMap((x) => x.days);
    if (status && status !== 'all') rows = rows.filter((r) => r.status === status);
    rows.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.workDate.localeCompare(a.workDate) || a.employeeCode.localeCompare(b.employeeCode));
    return { policy: { ...policy, showPay: canSeePay(user) }, rows };
  }

  /** Approve (optionally fewer minutes) or reject one or many days. Managers only for their departments. */
  async review(user: AuthUser, items: { employeeId: string; workDate: string; decision: 'approve' | 'reject'; minutes?: number; note?: string }[], ip: string) {
    const companyId = user.companyId!;
    await this.ctx.assertPayrollOpen(companyId, items.map((i) => i.workDate));
    let done = 0;
    for (const it of items) {
      const scope = await this.compute(companyId, it.workDate, it.workDate, user, { employeeId: it.employeeId });
      const day = scope.employees[0]?.days[0];
      if (!day) throw badRequest(`No overtime found for that employee on ${it.workDate}.`, 'NO_OVERTIME');
      if (it.employeeId === user.employeeId) throw forbidden('You cannot approve your own overtime.', 'OWN_REQUEST');
      const minutes = it.decision === 'approve' ? Math.min(Math.max(0, Math.round(it.minutes ?? day.overtimeMinutes)), day.overtimeMinutes) : 0;
      await this.db.query(
        `INSERT INTO overtime_approvals (company_id, employee_id, work_date, status, approved_minutes, review_note, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (employee_id, work_date) DO UPDATE SET status = $4, approved_minutes = $5, review_note = $6, reviewed_by = $7, reviewed_at = now(), updated_at = now()`,
        [companyId, it.employeeId, it.workDate, it.decision === 'approve' ? 'approved' : 'rejected', minutes, it.note?.trim() || null, user.id],
      );
      await this.audit.log({
        companyId, userId: user.id, action: it.decision, module: 'overtime', recordId: `${it.employeeId}:${it.workDate}`,
        oldValue: { status: day.status, minutes: day.countedMinutes }, newValue: { status: it.decision === 'approve' ? 'approved' : 'rejected', minutes, note: it.note }, ip,
      });
      this.telegram.notifyEmployee(it.employeeId, tgMessages.overtime(it.decision, it.workDate, minutes, it.note));
      done++;
    }
    return { reviewed: done };
  }

  /** The employee explains a day's overtime (shown to the approver). */
  async reason(user: AuthUser, workDate: string, reason: string, ip: string) {
    const employeeId = requireEmployee(user);
    const companyId = user.companyId!;
    const r = await this.db.maybeOne(
      `INSERT INTO overtime_approvals (company_id, employee_id, work_date, reason) VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, work_date) DO UPDATE SET reason = $4, updated_at = now()
       RETURNING status`,
      [companyId, employeeId, workDate, reason.trim()],
    );
    await this.audit.log({ companyId, userId: user.id, action: 'reason', module: 'overtime', recordId: `${employeeId}:${workDate}`, newValue: { reason }, ip });
    return { ok: true, status: r?.status };
  }

  /** The employee's own OT days (phone history). */
  async mine(user: AuthUser, from: string, to: string) {
    const employeeId = requireEmployee(user);
    const { policy, employees } = await this.compute(user.companyId!, from, to, null, { employeeId });
    return {
      requiresApproval: policy.requiresApproval,
      days: (employees[0]?.days ?? []).map((d) => ({ workDate: d.workDate, overtimeMinutes: d.overtimeMinutes, countedMinutes: d.countedMinutes, status: d.status, reason: d.reason, reviewNote: d.reviewNote })),
    };
  }

  async pendingCount(user: AuthUser): Promise<number> {
    const policy = await this.getPolicy(user.companyId!);
    if (!policy.requiresApproval) return 0;
    const company = await this.ctx.get(user.companyId!);
    const today = localParts(new Date(), company.timezone).date;
    const from = `${today.slice(0, 7)}-01`;
    const prevMonth = new Date(`${from}T00:00:00Z`);
    prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
    const { employees } = await this.compute(user.companyId!, prevMonth.toISOString().slice(0, 10), today, user);
    return employees.reduce((n, x) => n + x.days.filter((d) => d.status === 'pending').length, 0);
  }
}
