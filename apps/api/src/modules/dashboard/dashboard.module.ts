import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Db } from '../../database/db.service';
import { AuthUser, CurrentUser, requireCompany, Roles, STAFF_ROLES } from '../../common/auth';
import { scopeEmployees, Where } from '../../common/sql';
import { TYPE_LABELS, AttendanceType } from '../../domain/punch-rules';
import { addDays, isIsoDate, localParts } from '../../domain/time';
import { CompanyContextService } from '../core/company-context.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { AttendanceSummaryService, countStatuses } from '../attendance/summary.service';

@Injectable()
export class DashboardService {
  constructor(private readonly db: Db, private readonly ctx: CompanyContextService, private readonly summaries: AttendanceSummaryService) {}

  async get(user: AuthUser, date?: string) {
    const companyId = user.companyId!;
    const company = await this.ctx.get(companyId);
    const today = this.ctx.now(company.timezone).date;
    const day = date && isIsoDate(date) && date <= today ? date : today;
    const from = addDays(day, -13);
    const built = await this.summaries.build(companyId, from, day, user);

    const trend: { date: string; present: number; late: number; absent: number; leave: number; total: number }[] = [];
    for (let d = from; d <= day; d = addDays(d, 1)) {
      const list = built.employees.map((e) => built.days.get(e.id)?.find((s) => s.date === d)).filter((s): s is NonNullable<typeof s> => !!s);
      const c = countStatuses(list);
      trend.push({ date: d, present: c.present, late: c.late, absent: c.absent, leave: c.leave, total: c.total - c.dayOff - c.holiday });
    }
    const todays = built.employees.map((e) => ({ e, s: built.days.get(e.id)?.find((s) => s.date === day) })).filter((x) => !!x.s);
    const counts = countStatuses(todays.map((x) => x.s!));

    const byDept = new Map<string, { name: string; total: number; present: number; late: number; absent: number }>();
    for (const { e, s } of todays) {
      if (s!.status === 'day_off' || s!.status === 'holiday') continue;
      const name = e.department ?? '(none)';
      const g = byDept.get(name) ?? { name, total: 0, present: 0, late: 0, absent: 0 };
      g.total++;
      if (s!.status === 'present' || s!.status === 'late') g.present++;
      if (s!.status === 'late') g.late++;
      if (s!.status === 'absent') g.absent++;
      byDept.set(name, g);
    }

    const w = new Where().add('a.company_id = ?', companyId).add('a.work_date = ?', day).add('NOT a.is_void');
    scopeEmployees(w, user);
    const recent = await this.db.query(
      `SELECT a.id, a.attendance_type, a.scan_time, a.status, a.distance_from_branch, a.source, e.name, e.employee_code, e.profile_photo, b.name AS branch_name
         FROM attendance a JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
         ${w} ORDER BY a.scan_time DESC LIMIT 12`,
      w.params,
    );

    const isAdmin = user.role !== 'manager';
    const scopeSql = (alias: string) => (user.role === 'manager' ? ` AND ${alias}.department_id = ANY($2::uuid[])` : '');
    const scopeParams = user.role === 'manager' ? [companyId, user.departmentIds ?? []] : [companyId];
    const pending = await this.db.one(
      `SELECT
         (SELECT count(*) FROM devices v JOIN employees e ON e.id = v.employee_id WHERE v.company_id = $1 AND v.status = 'pending'${scopeSql('e')})::int AS devices,
         (SELECT count(*) FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id WHERE c.company_id = $1 AND c.status = 'pending'${scopeSql('e')})::int AS corrections,
         (SELECT count(*) FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.company_id = $1 AND l.status = 'pending'${scopeSql('e')})::int AS leave,
         (SELECT count(*) FROM attendance_attempts t LEFT JOIN employees e ON e.id = t.employee_id WHERE t.company_id = $1 AND t.created_at > now() - interval '24 hours' AND t.reason_code <> 'DUPLICATE_SCAN'${scopeSql('e')})::int AS rejected`,
      scopeParams,
    );

    return {
      date: day,
      today,
      timezone: company.timezone,
      counts: {
        totalEmployees: counts.total,
        scheduled: counts.total - counts.dayOff - counts.holiday,
        present: counts.present,
        late: counts.late,
        absent: counts.absent,
        leave: counts.leave,
        notYet: counts.notYet,
        checkedOut: counts.checkedOut,
        overtime: counts.overtime,
        earlyLeave: counts.earlyLeave,
        dayOff: counts.dayOff,
        holiday: counts.holiday,
      },
      trend,
      departments: [...byDept.values()].sort((a, b) => b.total - a.total),
      recent: recent.map((r) => ({
        id: r.id, type: r.attendance_type, typeLabel: TYPE_LABELS[r.attendance_type as AttendanceType], time: localParts(new Date(r.scan_time), company.timezone).time,
        status: r.status, distance: r.distance_from_branch, source: r.source, name: r.name, employeeCode: r.employee_code, photo: r.profile_photo, branch: r.branch_name,
      })),
      pending: { ...pending, canApprove: isAdmin },
    };
  }
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Counts for a date (present, late, absent, leave, checked out, overtime), 14-day trend, departments, latest scans, pending approvals.' })
  get(@CurrentUser() u: AuthUser, @Query('date') date?: string) {
    requireCompany(u);
    return this.dashboard.get(u, date);
  }
}

@Module({ imports: [AttendanceModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
