import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service';
import { AuthUser } from '../../common/auth';
import { scopeEmployees, Where } from '../../common/sql';
import { DayPunch, DaySummary, summarizeDay } from '../../domain/daily-summary';
import { Schedule } from '../../domain/punch-rules';
import { dateRange, isoWeekday } from '../../domain/time';
import { CompanyContextService } from '../core/company-context.service';

export interface SummaryEmployee {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string | null;
  department: string | null;
  positionId: string | null;
  position: string | null;
  branchId: string | null;
  branch: string | null;
  scheduleId: string | null;
  status: string;
  profilePhoto: string | null;
  hiredOn: string | null;
}

export interface SummaryFilter {
  employeeIds?: string[];
  departmentId?: string;
  branchId?: string;
  search?: string;
  /** Include inactive employees (they still appear for days they have scans). */
  includeInactive?: boolean;
}

export interface SummaryResult {
  today: string;
  nowMinutes: number;
  timezone: string;
  employees: SummaryEmployee[];
  /** employee id -> one summary per date in range (dates before the hire date are left out) */
  days: Map<string, DaySummary[]>;
  /** employee id -> date -> punches */
  punches: Map<string, Map<string, (DayPunch & { latitude: number | null; longitude: number | null; branchName: string | null; source: string })[]>>;
  schedules: Map<string, Schedule>;
}

/**
 * Builds daily results for many employees and dates at once (dashboard, live view, reports, employee history).
 * One query each for employees, scans, holidays and leave; the per-day logic is the pure summarizeDay().
 */
@Injectable()
export class AttendanceSummaryService {
  constructor(private readonly db: Db, private readonly ctx: CompanyContextService) {}

  async build(companyId: string, from: string, to: string, user: AuthUser | null, filter: SummaryFilter = {}): Promise<SummaryResult> {
    const company = await this.ctx.get(companyId);
    const now = this.ctx.now(company.timezone);

    const w = new Where().add('e.company_id = ?', companyId);
    if (user) scopeEmployees(w, user);
    if (filter.employeeIds) w.add('e.id = ANY(?::uuid[])', filter.employeeIds);
    w.addIf(filter.departmentId, 'e.department_id = ?');
    w.addIf(filter.branchId, 'e.branch_id = ?');
    if (filter.search?.trim()) {
      const like = `%${filter.search.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      w.add('(e.name ILIKE ? OR e.employee_code ILIKE ?)', like, like);
    }
    if (!filter.includeInactive) {
      w.add(`(e.status = 'active' OR EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.work_date BETWEEN ? AND ? AND NOT a.is_void))`, from, to);
    }
    const empRows = await this.db.query(
      `SELECT e.id, e.employee_code, e.name, e.department_id, d.name AS department, e.position_id, p.name AS position,
              e.branch_id, b.name AS branch, e.schedule_id, e.status, e.profile_photo, e.hired_on
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN positions p ON p.id = e.position_id
         LEFT JOIN branches b ON b.id = e.branch_id
         ${w} ORDER BY e.employee_code`,
      w.params,
    );
    const employees: SummaryEmployee[] = empRows.map((r) => ({
      id: r.id, employeeCode: r.employee_code, name: r.name, departmentId: r.department_id, department: r.department, positionId: r.position_id,
      position: r.position, branchId: r.branch_id, branch: r.branch, scheduleId: r.schedule_id, status: r.status, profilePhoto: r.profile_photo, hiredOn: r.hired_on,
    }));
    const ids = employees.map((e) => e.id);

    const [schedules, holidays, leave, recs] = await Promise.all([
      this.ctx.schedules(companyId),
      this.ctx.holidays(companyId, from, to),
      this.ctx.approvedLeave(companyId, from, to),
      ids.length
        ? this.db.query(
            `SELECT a.id, a.employee_id, a.attendance_type, a.scan_time, a.work_date, a.status, a.late_minutes, a.early_minutes, a.overtime_minutes,
                    a.branch_id, a.distance_from_branch, a.latitude, a.longitude, a.source, b.name AS branch_name,
                    extract(epoch FROM (a.scan_time AT TIME ZONE $4)::time) / 60 AS local_minutes
               FROM attendance a LEFT JOIN branches b ON b.id = a.branch_id
              WHERE a.company_id = $1 AND a.work_date BETWEEN $2 AND $3 AND NOT a.is_void AND a.employee_id = ANY($5::uuid[])
              ORDER BY a.scan_time`,
            [companyId, from, to, company.timezone, ids],
          )
        : Promise.resolve([]),
    ]);

    const punches: SummaryResult['punches'] = new Map();
    for (const r of recs) {
      let byDate = punches.get(r.employee_id);
      if (!byDate) punches.set(r.employee_id, (byDate = new Map()));
      const list = byDate.get(r.work_date) ?? [];
      list.push({
        id: r.id, type: r.attendance_type, time: r.scan_time, minutes: Number(r.local_minutes), lateMinutes: r.late_minutes, earlyMinutes: r.early_minutes,
        overtimeMinutes: r.overtime_minutes, status: r.status, branchId: r.branch_id, distance: r.distance_from_branch, latitude: r.latitude,
        longitude: r.longitude, branchName: r.branch_name, source: r.source,
      });
      byDate.set(r.work_date, list);
    }

    const dates = dateRange(from, to);
    const days = new Map<string, DaySummary[]>();
    for (const e of employees) {
      const schedule = (e.scheduleId && schedules.get(e.scheduleId)) || schedules.get('') || null;
      const myLeave = leave.get(e.id) ?? [];
      const myPunches = punches.get(e.id);
      const list: DaySummary[] = [];
      for (const date of dates) {
        const dayPunches = myPunches?.get(date) ?? [];
        if (e.hiredOn && date < e.hiredOn && !dayPunches.length) continue;
        if (e.status !== 'active' && !dayPunches.length) continue;
        const lv = myLeave.find((l) => l.start <= date && l.end >= date);
        list.push(
          summarizeDay(
            {
              date,
              when: date < now.date ? 'past' : date === now.date ? 'today' : 'future',
              nowMinutes: now.minutes,
              schedule,
              weekday: isoWeekday(date),
              holiday: holidays.get(date) ?? null,
              leave: lv ? { type: lv.type } : null,
              rules: company.rules,
            },
            dayPunches,
          ),
        );
      }
      days.set(e.id, list);
    }
    return { today: now.date, nowMinutes: now.minutes, timezone: company.timezone, employees, days, punches, schedules };
  }
}

/** Counts by status for one date's summaries. */
export function countStatuses(summaries: DaySummary[]) {
  const c = { total: 0, present: 0, late: 0, absent: 0, leave: 0, notYet: 0, holiday: 0, dayOff: 0, checkedOut: 0, overtime: 0, earlyLeave: 0, missingCheckOut: 0 };
  for (const s of summaries) {
    c.total++;
    if (s.status === 'present' || s.status === 'late') c.present++;
    if (s.status === 'late') c.late++;
    if (s.status === 'absent') c.absent++;
    if (s.status === 'leave') c.leave++;
    if (s.status === 'not_yet') c.notYet++;
    if (s.status === 'holiday') c.holiday++;
    if (s.status === 'day_off') c.dayOff++;
    if (s.checkOut) c.checkedOut++;
    if (s.overtimeMinutes > 0) c.overtime++;
    if (s.flags.includes('early_leave')) c.earlyLeave++;
    if (s.flags.includes('missing_check_out')) c.missingCheckOut++;
  }
  return c;
}
