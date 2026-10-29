import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Db } from '../../database/db.service';
import { AuthUser, clientIp, CurrentUser, requireCompany, Roles, STAFF_ROLES } from '../../common/auth';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { scopeEmployees, Where } from '../../common/sql';
import { dateRange, daysBetween, isIsoDate, isoWeekday } from '../../domain/time';
import { AuditService } from '../audit/audit.service';
import { CompanyContextService } from '../core/company-context.service';
import { TelegramService } from '../core/telegram.service';
import { adminMessages, REVIEW, tgMessages, REVIEW_LEAVE } from '../core/telegram-messages';

export const LEAVE_TYPES = ['annual', 'sick', 'personal', 'maternity', 'unpaid', 'other'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class LeaveDto {
  @ApiPropertyOptional({ description: 'Staff only: request on behalf of an employee' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiProperty({ enum: LEAVE_TYPES }) @IsIn(LEAVE_TYPES as unknown as string[]) leaveType: string;
  @ApiProperty({ example: '2026-10-12' }) @Matches(DATE, { message: 'Start date must be YYYY-MM-DD' }) startDate: string;
  @ApiProperty({ example: '2026-10-13' }) @Matches(DATE, { message: 'End date must be YYYY-MM-DD' }) endDate: string;
  @ApiPropertyOptional({ description: 'Half day (start date = end date)' }) @IsOptional() @IsBoolean() halfDay?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class ReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

function mapLeave(r: any) {
  return {
    id: r.id, employeeId: r.employee_id, employeeCode: r.employee_code, employeeName: r.employee_name, department: r.department_name,
    leaveType: r.leave_type, startDate: r.start_date, endDate: r.end_date, days: r.days, reason: r.reason, status: r.status,
    approvedBy: r.approved_by_name, approvedAt: r.approved_at, reviewNote: r.review_note, createdAt: r.created_at,
  };
}

const SELECT = `
  SELECT l.*, e.employee_code, e.name AS employee_name, d.name AS department_name, u.name AS approved_by_name
    FROM leave_requests l JOIN employees e ON e.id = l.employee_id
    LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN users u ON u.id = l.approved_by`;

@Injectable()
export class LeaveService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly ctx: CompanyContextService, private readonly telegram: TelegramService) {}

  /** Working days in the range (schedule work days, minus holidays). */
  private async countDays(companyId: string, scheduleId: string | null, start: string, end: string, halfDay: boolean) {
    const schedule = await this.ctx.scheduleFor(companyId, scheduleId);
    const holidays = await this.ctx.holidays(companyId, start, end);
    const days = dateRange(start, end).filter((d) => !holidays.has(d) && (!schedule || schedule.workDays.includes(isoWeekday(d)))).length;
    return halfDay ? Math.min(days, 1) * 0.5 : days;
  }

  async list(user: AuthUser, q: { status?: string; mine?: boolean; employeeId?: string; from?: string; to?: string }) {
    const w = new Where().add('l.company_id = ?', user.companyId);
    if (q.mine || user.role === 'employee') w.add('l.employee_id = ?', user.employeeId);
    else scopeEmployees(w, user);
    if (q.status && ['pending', 'approved', 'rejected', 'cancelled'].includes(q.status)) w.add('l.status = ?', q.status);
    if (q.employeeId) w.add('l.employee_id = ?', q.employeeId);
    if (q.from) w.add('l.end_date >= ?', q.from);
    if (q.to) w.add('l.start_date <= ?', q.to);
    const rows = await this.db.query(`${SELECT} ${w} ORDER BY (l.status = 'pending') DESC, l.start_date DESC LIMIT 500`, w.params);
    return rows.map(mapLeave);
  }

  async create(user: AuthUser, dto: LeaveDto, ip: string) {
    const companyId = user.companyId!;
    if (!isIsoDate(dto.startDate) || !isIsoDate(dto.endDate)) throw badRequest('Dates are not valid.', 'BAD_DATE');
    if (dto.endDate < dto.startDate) throw badRequest('End date must be on or after the start date.', 'BAD_RANGE');
    if (daysBetween(dto.startDate, dto.endDate) > 180) throw badRequest('Leave can be at most 180 days per request.', 'BAD_RANGE');
    if (dto.halfDay && dto.startDate !== dto.endDate) throw badRequest('A half day must start and end on the same date.', 'BAD_RANGE');
    let employeeId = user.employeeId;
    if (dto.employeeId && dto.employeeId !== user.employeeId) {
      if (user.role === 'employee') throw forbidden();
      employeeId = dto.employeeId;
    }
    if (!employeeId) throw badRequest('Choose an employee.', 'EMPLOYEE_REQUIRED');
    const w = new Where().add('e.company_id = ?', companyId).add('e.id = ?', employeeId);
    if (employeeId !== user.employeeId) scopeEmployees(w, user);
    const emp = await this.db.maybeOne(`SELECT e.id, e.schedule_id FROM employees e ${w}`, w.params);
    if (!emp) throw notFound('Employee');
    const overlap = await this.db.maybeOne(
      `SELECT 1 FROM leave_requests WHERE employee_id = $1 AND status IN ('pending', 'approved') AND start_date <= $3 AND end_date >= $2`,
      [employeeId, dto.startDate, dto.endDate],
    );
    if (overlap) throw badRequest('You already have leave in that period.', 'LEAVE_OVERLAP');
    const days = await this.countDays(companyId, emp.schedule_id, dto.startDate, dto.endDate, !!dto.halfDay);
    if (days <= 0) throw badRequest('There are no working days in that period.', 'NO_WORKING_DAYS');
    const r = await this.db.one(
      `INSERT INTO leave_requests (company_id, employee_id, leave_type, start_date, end_date, days, reason) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [companyId, employeeId, dto.leaveType, dto.startDate, dto.endDate, days, dto.reason?.trim() || null],
    );
    await this.audit.log({ companyId, userId: user.id, action: 'request', module: 'leave_requests', recordId: r.id, newValue: { ...dto, days }, ip });
    const who = await this.db.one('SELECT name, employee_code, department_id, branch_id FROM employees WHERE id = $1', [employeeId]);
    const msg = adminMessages.newLeave(who.name, who.employee_code, dto.leaveType, dto.startDate, dto.endDate, Number(days), dto.reason ?? null);
    this.telegram.alertAdmins(companyId, 'requests', who.department_id, msg, [REVIEW]);
    this.telegram.notifyGroups(companyId, 'leave', who.branch_id, msg, REVIEW_LEAVE);
    return this.get(user, r.id);
  }

  async get(user: AuthUser, id: string) {
    const w = new Where().add('l.company_id = ?', user.companyId).add('l.id = ?', id);
    if (user.role === 'employee') w.add('l.employee_id = ?', user.employeeId);
    else scopeEmployees(w, user);
    const r = await this.db.maybeOne(`${SELECT} ${w}`, w.params);
    if (!r) throw notFound('Leave request');
    return mapLeave(r);
  }

  /** HR/admin decide any request; managers decide for their departments (not their own). */
  async review(user: AuthUser, id: string, decision: 'approve' | 'reject', note: string | undefined, ip: string) {
    const current = await this.get(user, id);
    if (current.status !== 'pending') throw badRequest('This request was already handled.', 'ALREADY_REVIEWED');
    if (current.employeeId === user.employeeId) throw forbidden('You cannot approve your own leave.', 'OWN_REQUEST');
    if (decision === 'approve') await this.ctx.assertPayrollOpen(user.companyId!, [current.startDate, current.endDate]);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await this.db.query(`UPDATE leave_requests SET status = $2, approved_by = $3, approved_at = now(), review_note = $4 WHERE id = $1 AND status = 'pending'`, [id, status, user.id, note?.trim() || null]);
    await this.audit.log({ companyId: user.companyId, userId: user.id, action: decision, module: 'leave_requests', recordId: id, oldValue: { status: 'pending' }, newValue: { status, note }, ip });
    this.telegram.notifyEmployee(current.employeeId, tgMessages.leave(decision, current.leaveType, current.startDate, current.endDate, note), [{ text: { en: '🌴 My leave', km: '🌴 ច្បាប់របស់ខ្ញុំ' }, path: '/app/leave' }]);
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, ip: string) {
    const r = await this.db.maybeOne(
      `UPDATE leave_requests SET status = 'cancelled' WHERE company_id = $1 AND id = $2 AND employee_id = $3 AND status = 'pending' RETURNING id`,
      [user.companyId, id, user.employeeId],
    );
    if (!r) throw badRequest('Only your own pending requests can be cancelled.', 'CANNOT_CANCEL');
    await this.audit.log({ companyId: user.companyId, userId: user.id, action: 'cancel', module: 'leave_requests', recordId: id, ip });
    return { ok: true };
  }
}

const uuid = new ParseUUIDPipe();

@ApiTags('Leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get()
  @ApiOperation({ summary: 'Leave requests (employees see their own).' })
  list(@CurrentUser() u: AuthUser, @Query() q: any) {
    requireCompany(u);
    return this.leave.list(u, {
      status: q.status,
      mine: q.mine === 'true',
      employeeId: /^[0-9a-f-]{36}$/i.test(q.employeeId || '') ? q.employeeId : undefined,
      from: DATE.test(q.from || '') ? q.from : undefined,
      to: DATE.test(q.to || '') ? q.to : undefined,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Request leave. Days are counted from the work schedule, excluding holidays.' })
  create(@Body() dto: LeaveDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.leave.create(u, dto, clientIp(req));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles(...STAFF_ROLES)
  approve(@Param('id', uuid) id: string, @Body() dto: ReviewDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.leave.review(u, id, 'approve', dto.note, clientIp(req));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles(...STAFF_ROLES)
  reject(@Param('id', uuid) id: string, @Body() dto: ReviewDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.leave.review(u, id, 'reject', dto.note, clientIp(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.leave.cancel(u, id, clientIp(req));
  }
}

@Module({ controllers: [LeaveController], providers: [LeaveService] })
export class LeaveModule {}
