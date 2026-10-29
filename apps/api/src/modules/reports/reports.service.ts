import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service';
import { AuthUser } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { scopeEmployees, Where } from '../../common/sql';
import { DaySummary } from '../../domain/daily-summary';
import { addDays, daysBetween, isIsoDate, localParts } from '../../domain/time';
import { CompanyContextService } from '../core/company-context.service';
import { AttendanceSummaryService, SummaryEmployee } from '../attendance/summary.service';
import { OvertimeService } from '../overtime/overtime.service';

export const REPORT_TYPES = ['daily', 'monthly', 'employee', 'department', 'branch', 'late', 'absent', 'early-leave', 'overtime', 'overtime-pay', 'leave', 'exceptions'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface Report {
  type: ReportType;
  title: string;
  subtitle: string;
  companyName: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
}

export interface ReportQuery {
  date?: string;
  month?: string;
  from?: string;
  to?: string;
  departmentId?: string;
  branchId?: string;
  employeeId?: string;
}

const STATUS_LABEL: Record<string, string> = {
  present: 'Present', late: 'Late', absent: 'Absent', leave: 'Leave', holiday: 'Holiday', day_off: 'Day off', not_yet: 'Not yet in', upcoming: '',
};
const FLAG_LABEL: Record<string, string> = {
  early_leave: 'Early leave', overtime: 'Overtime', missing_check_in: 'Missing check-in', missing_check_out: 'Missing check-out',
  late_from_lunch: 'Late from lunch', worked_on_leave: 'Worked on leave',
};

export const hm = (minutes: number) => (minutes > 0 ? `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}` : '');

const EMP_COLS: ReportColumn[] = [
  { key: 'employeeCode', label: 'Employee ID', width: 12 },
  { key: 'name', label: 'Name', width: 24 },
  { key: 'department', label: 'Department', width: 18 },
];

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: Db,
    private readonly ctx: CompanyContextService,
    private readonly summaries: AttendanceSummaryService,
    private readonly overtime: OvertimeService,
  ) {}

  /** Resolves date / month / from-to into a range, defaulting to today or this month. */
  private range(type: ReportType, q: ReportQuery, today: string): { from: string; to: string } {
    if (type === 'daily') {
      const d = q.date ?? q.from ?? today;
      if (!isIsoDate(d)) throw badRequest('Date is not valid.', 'BAD_DATE');
      return { from: d, to: d };
    }
    let from = q.from;
    let to = q.to;
    if (q.month) {
      if (!/^\d{4}-\d{2}$/.test(q.month)) throw badRequest('Month must be YYYY-MM.', 'BAD_DATE');
      from = `${q.month}-01`;
      const next = new Date(`${from}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      to = addDays(next.toISOString().slice(0, 10), -1);
    }
    from ??= `${today.slice(0, 7)}-01`;
    to ??= today;
    if (!isIsoDate(from) || !isIsoDate(to)) throw badRequest('Dates are not valid.', 'BAD_DATE');
    if (to > today && type !== 'leave') to = today;
    if (from > to) throw badRequest('"From" must be on or before "to".', 'BAD_RANGE');
    if (daysBetween(from, to) > 370) throw badRequest('Choose a range of at most one year.', 'BAD_RANGE');
    return { from, to };
  }

  async build(user: AuthUser, type: ReportType, q: ReportQuery): Promise<Report> {
    if (!REPORT_TYPES.includes(type)) throw badRequest('Unknown report.', 'BAD_REPORT');
    const companyId = user.companyId!;
    const company = await this.ctx.get(companyId);
    const today = this.ctx.now(company.timezone).date;
    const { from, to } = this.range(type, q, today);
    const tz = company.timezone;
    const t = (d: Date | null) => (d ? localParts(new Date(d), tz).time : '');
    const period = from === to ? from : `${from} to ${to}`;
    const scopeNote = await this.scopeNote(companyId, q);
    const base = { type, companyName: company.name, generatedAt: new Date().toISOString(), subtitle: `${period}${scopeNote}` };

    if (type === 'leave') return { ...base, ...(await this.leaveReport(user, from, to, q)) };

    if (type === 'employee' && !q.employeeId) throw badRequest('Choose an employee.', 'EMPLOYEE_REQUIRED');
    // Overtime with approval status and pay (monthly summary, overtime and overtime-pay reports).
    const ot = ['monthly', 'overtime', 'overtime-pay'].includes(type)
      ? await this.overtime.compute(companyId, from, to, user, { departmentId: q.departmentId, branchId: q.branchId, employeeId: q.employeeId })
      : null;
    const otBy = new Map((ot?.employees ?? []).map((x) => [x.employee.id, x]));
    const showPay = user.role !== 'manager';
    const money = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
    const h = (min: number) => Math.round((min / 60) * 100) / 100;
    const OT_STATUS: Record<string, string> = { not_required: 'Counted', pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
    const DAY_TYPE: Record<string, string> = { work_day: 'Work day', day_off: 'Day off', holiday: 'Holiday' };

    if (type === 'overtime-pay') {
      const cur = ot!.policy.currency;
      const rows = ot!.employees
        .filter((x) => x.days.length)
        .map((x) => ({
          employeeCode: x.employee.employeeCode, name: x.employee.name, department: x.employee.department ?? '', branch: x.employee.branch ?? '',
          position: x.employee.position ?? '',
          hourlyRate: showPay ? money(x.hourlyRate) : null,
          otWorkDay: x.totals.workDayHours, otDayOff: x.totals.dayOffHours, otHoliday: x.totals.holidayHours,
          otDays: x.totals.otDays, paidDays: x.totals.paidDays || null, weighted: x.totals.weightedHours || null,
          pending: ot!.policy.requiresApproval ? h(x.pendingMinutes) || null : null,
          amount: showPay ? money(x.totals.amount) : null,
          note: [x.totals.missingRate ? 'No salary / hourly rate' : '', x.pendingMinutes ? 'Has OT waiting for approval' : ''].filter(Boolean).join('; '),
        }));
      const sum = (k: string) => Math.round(rows.reduce((t, r) => t + (Number((r as any)[k]) || 0), 0) * 100) / 100;
      const rule = (r: { mode: string; value: number; minHours: number }) =>
        r.mode === 'multiplier' ? `x${r.value}` : r.mode === 'fixed_hour' ? `${r.value} ${cur}/h` : `${r.value} ${cur}/day (min ${r.minHours} h)`;
      return {
        ...base,
        subtitle: `${base.subtitle} · Rates: work day ${rule(ot!.policy.workDay)}, day off ${rule(ot!.policy.dayOff)}, holiday ${rule(ot!.policy.holiday)}${ot!.policy.requiresApproval ? ' · approved OT only' : ''}`,
        title: 'Overtime pay (payroll)',
        columns: [
          ...EMP_COLS, { key: 'position', label: 'Position', width: 14 },
          ...(showPay ? [{ key: 'hourlyRate', label: `Hourly rate (${cur})`, align: 'right' as const, width: 10 }] : []),
          { key: 'otWorkDay', label: 'OT work day (h)', align: 'right', width: 10 }, { key: 'otDayOff', label: 'OT day off (h)', align: 'right', width: 10 },
          { key: 'otHoliday', label: 'OT holiday (h)', align: 'right', width: 10 }, { key: 'otDays', label: 'OT days', align: 'right', width: 7 },
          { key: 'paidDays', label: 'Paid per day', align: 'right', width: 8 }, { key: 'weighted', label: 'Weighted h', align: 'right', width: 9 },
          ...(ot!.policy.requiresApproval ? [{ key: 'pending', label: 'Pending (h)', align: 'right' as const, width: 9 }] : []),
          ...(showPay ? [{ key: 'amount', label: `OT pay (${cur})`, align: 'right' as const, width: 11 }] : []),
          { key: 'note', label: 'Note', width: 22 },
        ],
        rows,
        totals: { otWorkDay: sum('otWorkDay'), otDayOff: sum('otDayOff'), otHoliday: sum('otHoliday'), otDays: sum('otDays'), paidDays: sum('paidDays'), weighted: sum('weighted'), pending: sum('pending') || null, amount: showPay ? sum('amount') : null },
      };
    }

    const built = await this.summaries.build(companyId, from, to, user, {
      departmentId: q.departmentId, branchId: q.branchId, employeeIds: q.employeeId ? [q.employeeId] : undefined,
    });
    const each = (fn: (e: SummaryEmployee, d: DaySummary) => Record<string, any> | null) => {
      const out: Record<string, any>[] = [];
      for (const e of built.employees) for (const d of built.days.get(e.id) ?? []) {
        const row = fn(e, d);
        if (row) out.push(row);
      }
      return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || String(a.employeeCode).localeCompare(String(b.employeeCode)));
    };
    const emp = (e: SummaryEmployee) => ({ employeeCode: e.employeeCode, name: e.name, department: e.department ?? '', branch: e.branch ?? '' });
    const notes = (d: DaySummary) => [d.holiday, d.leaveType ? `Leave (${d.leaveType})` : null, ...d.flags.map((f) => FLAG_LABEL[f])].filter(Boolean).join(', ');

    switch (type) {
      case 'daily':
      case 'employee': {
        const dayCols: ReportColumn[] = [
          ...(type === 'employee' ? [{ key: 'date', label: 'Date', width: 11 }] : EMP_COLS),
          { key: 'branch', label: 'Branch', width: 16 },
          { key: 'checkIn', label: 'Check-in', width: 9, align: 'center' },
          { key: 'lunchOut', label: 'Lunch out', width: 9, align: 'center' },
          { key: 'lunchIn', label: 'Lunch in', width: 9, align: 'center' },
          { key: 'checkOut', label: 'Check-out', width: 9, align: 'center' },
          { key: 'worked', label: 'Worked', width: 8, align: 'right' },
          { key: 'late', label: 'Late (min)', width: 9, align: 'right' },
          { key: 'early', label: 'Early (min)', width: 9, align: 'right' },
          { key: 'overtime', label: 'OT (min)', width: 9, align: 'right' },
          { key: 'status', label: 'Status', width: 10 },
          { key: 'notes', label: 'Notes', width: 26 },
        ];
        const rows = each((e, d) =>
          d.status === 'upcoming' ? null : {
            date: d.date, ...emp(e), checkIn: t(d.checkIn), lunchOut: t(d.lunchOut), lunchIn: t(d.lunchIn), checkOut: t(d.checkOut),
            worked: hm(d.workedMinutes), late: d.lateMinutes || null, early: d.earlyMinutes || null, overtime: d.overtimeMinutes || null,
            status: STATUS_LABEL[d.status], notes: notes(d),
          },
        );
        const e0 = built.employees[0];
        return {
          ...base,
          title: type === 'daily' ? 'Daily attendance' : `Attendance: ${e0 ? `${e0.name} (${e0.employeeCode})` : ''}`,
          columns: dayCols,
          rows,
          totals: {
            late: rows.reduce((s, r) => s + (Number(r.late) || 0), 0),
            early: rows.reduce((s, r) => s + (Number(r.early) || 0), 0),
            overtime: rows.reduce((s, r) => s + (Number(r.overtime) || 0), 0),
          },
        };
      }

      case 'monthly': {
        const rows = built.employees.map((e) => {
          const days = built.days.get(e.id) ?? [];
          const c = { working: 0, present: 0, late: 0, absent: 0, leave: 0, holiday: 0, lateMin: 0, earlyMin: 0, otMin: 0, worked: 0, missing: 0 };
          for (const d of days) {
            if (d.isWorkingDay) c.working++;
            if (d.status === 'present' || d.status === 'late') c.present++;
            if (d.status === 'late') c.late++;
            if (d.status === 'absent') c.absent++;
            if (d.status === 'leave') c.leave++;
            if (d.status === 'holiday') c.holiday++;
            if (d.flags.includes('missing_check_out')) c.missing++;
            c.lateMin += d.lateMinutes;
            c.earlyMin += d.earlyMinutes;
            c.otMin += d.overtimeMinutes;
            c.worked += d.workedMinutes;
          }
          return {
            ...emp(e), position: e.position ?? '', workingDays: c.working, present: c.present, late: c.late, absent: c.absent, leave: c.leave, holidays: c.holiday,
            lateMinutes: c.lateMin, earlyMinutes: c.earlyMin, workedHours: Math.round((c.worked / 60) * 100) / 100,
            otWorkDay: otBy.get(e.id)?.totals.workDayHours || null, otDayOff: otBy.get(e.id)?.totals.dayOffHours || null,
            otHoliday: otBy.get(e.id)?.totals.holidayHours || null, otDays: otBy.get(e.id)?.totals.otDays || null,
            otPending: ot?.policy.requiresApproval ? h(otBy.get(e.id)?.pendingMinutes ?? 0) || null : null,
            missingCheckOut: c.missing, rate: c.working ? `${Math.round((c.present / c.working) * 100)}%` : '',
          };
        });
        return {
          ...base,
          title: 'Monthly attendance summary',
          columns: [
            ...EMP_COLS, { key: 'position', label: 'Position', width: 16 },
            { key: 'workingDays', label: 'Work days', align: 'right', width: 8 }, { key: 'present', label: 'Present', align: 'right', width: 8 },
            { key: 'late', label: 'Late', align: 'right', width: 6 }, { key: 'absent', label: 'Absent', align: 'right', width: 7 },
            { key: 'leave', label: 'Leave', align: 'right', width: 6 }, { key: 'holidays', label: 'Holidays', align: 'right', width: 8 },
            { key: 'lateMinutes', label: 'Late min', align: 'right', width: 8 }, { key: 'earlyMinutes', label: 'Early min', align: 'right', width: 8 },
            { key: 'otWorkDay', label: 'OT work day h', align: 'right', width: 9 }, { key: 'otDayOff', label: 'OT day off h', align: 'right', width: 9 },
            { key: 'otHoliday', label: 'OT holiday h', align: 'right', width: 9 }, { key: 'otDays', label: 'OT days', align: 'right', width: 7 },
            ...(ot?.policy.requiresApproval ? [{ key: 'otPending', label: 'OT pending h', align: 'right' as const, width: 9 }] : []),
            { key: 'workedHours', label: 'Worked hours', align: 'right', width: 10 },
            { key: 'missingCheckOut', label: 'No check-out', align: 'right', width: 9 }, { key: 'rate', label: 'Attendance', align: 'right', width: 9 },
          ],
          rows,
        };
      }

      case 'department':
      case 'branch': {
        const key = type === 'department' ? 'department' : 'branch';
        const groups = new Map<string, { name: string; employees: number; working: number; present: number; late: number; absent: number; leave: number; ot: number }>();
        for (const e of built.employees) {
          const name = (type === 'department' ? e.department : e.branch) || '(none)';
          const g = groups.get(name) ?? { name, employees: 0, working: 0, present: 0, late: 0, absent: 0, leave: 0, ot: 0 };
          g.employees++;
          for (const d of built.days.get(e.id) ?? []) {
            if (d.isWorkingDay) g.working++;
            if (d.status === 'present' || d.status === 'late') g.present++;
            if (d.status === 'late') g.late++;
            if (d.status === 'absent') g.absent++;
            if (d.status === 'leave') g.leave++;
            g.ot += d.overtimeMinutes;
          }
          groups.set(name, g);
        }
        const rows = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({
          [key]: g.name, employees: g.employees, workingDays: g.working, present: g.present, late: g.late, absent: g.absent, leave: g.leave,
          overtimeHours: Math.round((g.ot / 60) * 10) / 10, rate: g.working ? `${Math.round((g.present / g.working) * 100)}%` : '',
          lateRate: g.present ? `${Math.round((g.late / g.present) * 100)}%` : '',
        }));
        return {
          ...base,
          title: type === 'department' ? 'Attendance by department' : 'Attendance by branch',
          columns: [
            { key, label: type === 'department' ? 'Department' : 'Branch', width: 24 }, { key: 'employees', label: 'Employees', align: 'right' },
            { key: 'workingDays', label: 'Work days', align: 'right' }, { key: 'present', label: 'Present', align: 'right' },
            { key: 'late', label: 'Late', align: 'right' }, { key: 'absent', label: 'Absent', align: 'right' }, { key: 'leave', label: 'Leave', align: 'right' },
            { key: 'overtimeHours', label: 'OT hours', align: 'right' }, { key: 'rate', label: 'Attendance', align: 'right' }, { key: 'lateRate', label: 'Late %', align: 'right' },
          ],
          rows,
        };
      }

      case 'late': {
        const rows = each((e, d) => (d.lateMinutes > 0 ? { date: d.date, ...emp(e), checkIn: t(d.checkIn), lateMinutes: d.lateMinutes } : null));
        return { ...base, title: 'Late employees', columns: [{ key: 'date', label: 'Date', width: 11 }, ...EMP_COLS, { key: 'branch', label: 'Branch', width: 16 }, { key: 'checkIn', label: 'Check-in', align: 'center' }, { key: 'lateMinutes', label: 'Late (min)', align: 'right' }], rows, totals: { lateMinutes: rows.reduce((s, r) => s + r.lateMinutes, 0) } };
      }
      case 'absent': {
        const rows = each((e, d) => (d.status === 'absent' ? { date: d.date, ...emp(e), position: e.position ?? '' } : null));
        return { ...base, title: 'Absent employees', columns: [{ key: 'date', label: 'Date', width: 11 }, ...EMP_COLS, { key: 'position', label: 'Position', width: 16 }, { key: 'branch', label: 'Branch', width: 16 }], rows };
      }
      case 'early-leave': {
        const rows = each((e, d) => (d.earlyMinutes > 0 ? { date: d.date, ...emp(e), checkOut: t(d.checkOut), earlyMinutes: d.earlyMinutes } : null));
        return { ...base, title: 'Early leave', columns: [{ key: 'date', label: 'Date', width: 11 }, ...EMP_COLS, { key: 'branch', label: 'Branch', width: 16 }, { key: 'checkOut', label: 'Check-out', align: 'center' }, { key: 'earlyMinutes', label: 'Early (min)', align: 'right' }], rows };
      }
      case 'overtime': {
        const cur = ot!.policy.currency;
        const rows = ot!.employees
          .flatMap((x) => x.days)
          .sort((a, b) => a.workDate.localeCompare(b.workDate) || a.employeeCode.localeCompare(b.employeeCode))
          .map((d) => ({
            date: d.workDate, employeeCode: d.employeeCode, name: d.name, department: d.department ?? '', branch: d.branch ?? '',
            dayType: DAY_TYPE[d.dayType], checkIn: d.checkIn ?? '', checkOut: d.checkOut ?? '', worked: hm(d.workedMinutes),
            overtimeMinutes: d.overtimeMinutes, status: OT_STATUS[d.status], countedMinutes: d.countedMinutes,
            weighted: d.pay.weightedHours, amount: showPay ? money(d.pay.amount) : null, reason: d.reason ?? '',
          }));
        return {
          ...base, title: 'Overtime',
          columns: [
            { key: 'date', label: 'Date', width: 11 }, ...EMP_COLS, { key: 'dayType', label: 'Day', width: 9 },
            { key: 'checkIn', label: 'Check-in', align: 'center' }, { key: 'checkOut', label: 'Check-out', align: 'center' }, { key: 'worked', label: 'Worked', align: 'right' },
            { key: 'overtimeMinutes', label: 'OT (min)', align: 'right' },
            ...(ot!.policy.requiresApproval ? [{ key: 'status', label: 'Approval', width: 9 }, { key: 'countedMinutes', label: 'Approved (min)', align: 'right' as const }] : []),
            { key: 'weighted', label: 'Weighted h', align: 'right' },
            ...(showPay ? [{ key: 'amount', label: `OT pay (${cur})`, align: 'right' as const }] : []),
            { key: 'reason', label: 'Reason', width: 20 },
          ],
          rows,
          totals: {
            overtimeMinutes: rows.reduce((t, r) => t + r.overtimeMinutes, 0),
            countedMinutes: rows.reduce((t, r) => t + r.countedMinutes, 0),
            weighted: Math.round(rows.reduce((t, r) => t + (r.weighted ?? 0), 0) * 100) / 100,
            amount: showPay ? Math.round(rows.reduce((t, r) => t + (r.amount ?? 0), 0) * 100) / 100 : null,
          },
        };
      }
      case 'exceptions': {
        const rows = each((e, d) => {
          const issues = d.flags.filter((f) => f === 'missing_check_in' || f === 'missing_check_out' || f === 'worked_on_leave').map((f) => FLAG_LABEL[f]);
          return issues.length ? { date: d.date, ...emp(e), checkIn: t(d.checkIn), checkOut: t(d.checkOut), issue: issues.join(', ') } : null;
        });
        const suspicious = await this.suspicious(user, from, to, q);
        for (const s of suspicious) rows.push({ date: s.work_date, employeeCode: s.employee_code, name: s.name, department: s.department ?? '', branch: s.branch ?? '', checkIn: t(s.scan_time), checkOut: '', issue: s.remarks });
        const rejected = await this.rejectedSummary(user, from, to, q);
        for (const r of rejected) rows.push({ date: r.date, employeeCode: r.employee_code ?? '', name: r.name ?? '(unknown)', department: r.department ?? '', branch: '', checkIn: '', checkOut: '', issue: `Rejected scans: ${r.n} (${r.reasons})` });
        rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.employeeCode).localeCompare(String(b.employeeCode)));
        return { ...base, title: 'Attendance exceptions', columns: [{ key: 'date', label: 'Date', width: 11 }, ...EMP_COLS, { key: 'checkIn', label: 'Check-in', align: 'center' }, { key: 'checkOut', label: 'Check-out', align: 'center' }, { key: 'issue', label: 'Issue', width: 40 }], rows };
      }
    }
    throw badRequest('Unknown report.', 'BAD_REPORT');
  }

  private async scopeNote(companyId: string, q: ReportQuery) {
    const parts: string[] = [];
    if (q.departmentId) parts.push((await this.db.maybeOne('SELECT name FROM departments WHERE company_id = $1 AND id = $2', [companyId, q.departmentId]))?.name);
    if (q.branchId) parts.push((await this.db.maybeOne('SELECT name FROM branches WHERE company_id = $1 AND id = $2', [companyId, q.branchId]))?.name);
    const p = parts.filter(Boolean);
    return p.length ? ` · ${p.join(' · ')}` : '';
  }

  private async suspicious(user: AuthUser, from: string, to: string, q: ReportQuery) {
    const w = new Where().add('a.company_id = ?', user.companyId).add('a.work_date BETWEEN ? AND ?', from, to).add(`a.remarks LIKE 'Suspicious%'`).add('NOT a.is_void');
    scopeEmployees(w, user);
    w.addIf(q.departmentId, 'e.department_id = ?').addIf(q.branchId, 'e.branch_id = ?').addIf(q.employeeId, 'e.id = ?');
    return this.db.query(
      `SELECT a.work_date, a.scan_time, a.remarks, e.employee_code, e.name, d.name AS department, b.name AS branch
         FROM attendance a JOIN employees e ON e.id = a.employee_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN branches b ON b.id = e.branch_id ${w}`,
      w.params,
    );
  }

  private async rejectedSummary(user: AuthUser, from: string, to: string, q: ReportQuery) {
    const { timezone } = await this.ctx.get(user.companyId!);
    const w = new Where([timezone]).add('t.company_id = ?', user.companyId).add(`(t.created_at AT TIME ZONE $1)::date BETWEEN ? AND ?`, from, to);
    scopeEmployees(w, user);
    w.addIf(q.departmentId, 'e.department_id = ?').addIf(q.employeeId, 'e.id = ?');
    return this.db.query(
      `SELECT to_char((t.created_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS date, e.employee_code, e.name, d.name AS department, count(*)::int AS n,
              string_agg(DISTINCT t.reason_code, ', ') AS reasons
         FROM attendance_attempts t LEFT JOIN employees e ON e.id = t.employee_id LEFT JOIN departments d ON d.id = e.department_id
         ${w} AND t.reason_code <> 'DUPLICATE_SCAN'
        GROUP BY 1, 2, 3, 4`,
      w.params,
    );
  }

  private async leaveReport(user: AuthUser, from: string, to: string, q: ReportQuery) {
    const w = new Where().add('l.company_id = ?', user.companyId).add('l.start_date <= ?', to).add('l.end_date >= ?', from).add(`l.status IN ('approved', 'pending')`);
    scopeEmployees(w, user);
    w.addIf(q.departmentId, 'e.department_id = ?').addIf(q.branchId, 'e.branch_id = ?').addIf(q.employeeId, 'e.id = ?');
    const rows = await this.db.query(
      `SELECT e.employee_code, e.name, d.name AS department, l.leave_type, l.start_date, l.end_date, l.days, l.status, l.reason
         FROM leave_requests l JOIN employees e ON e.id = l.employee_id LEFT JOIN departments d ON d.id = e.department_id
         ${w} ORDER BY l.start_date, e.employee_code`,
      w.params,
    );
    return {
      title: 'Leave',
      columns: [
        ...EMP_COLS, { key: 'leaveType', label: 'Type', width: 10 }, { key: 'startDate', label: 'From', width: 11 }, { key: 'endDate', label: 'To', width: 11 },
        { key: 'days', label: 'Days', align: 'right' as const, width: 6 }, { key: 'status', label: 'Status', width: 9 }, { key: 'reason', label: 'Reason', width: 30 },
      ],
      rows: rows.map((r) => ({
        employeeCode: r.employee_code, name: r.name, department: r.department ?? '', leaveType: r.leave_type, startDate: r.start_date, endDate: r.end_date,
        days: r.days, status: r.status, reason: r.reason ?? '',
      })),
      totals: { days: rows.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.days), 0) },
    };
  }
}
