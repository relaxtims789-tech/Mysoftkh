import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ADMIN_ROLES, AuthUser, clientIp, CurrentUser, requireCompany, requireEmployee, Roles, STAFF_ROLES } from '../../common/auth';
import { ChallengeService } from '../devices/challenge.service';
import { HistoryQuery, LiveQuery, PunchDto, RecordsQuery, ScanDto, VoidDto } from './attendance.dto';
import { AttendanceService } from './attendance.service';

const uuid = new ParseUUIDPipe();
const meta = (req: Request) => ({ ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '') });
/** Scanning is limited per user/IP to stop scripted guessing. */
const scanThrottle = Throttle({ default: { limit: 12, ttl: 60_000 } });

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService, private readonly challenges: ChallengeService) {}

  @Get('challenge')
  @ApiOperation({ summary: 'One-time challenge (2 minutes) that the phone signs with its device key.' })
  challenge(@CurrentUser() u: AuthUser) {
    requireEmployee(u);
    return this.challenges.issue(u.id);
  }

  @Post('scan')
  @HttpCode(200)
  @scanThrottle
  @ApiOperation({ summary: 'Record attendance from a scanned branch QR. The server picks check-in / lunch / check-out unless `type` is given.' })
  scan(@Body() dto: ScanDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.attendance.scan(u, dto, meta(req));
  }

  @Post('punch')
  @HttpCode(200)
  @scanThrottle
  @ApiOperation({ summary: 'Check-in / check-out button without scanning the QR (only when the company allows it). GPS picks the branch.' })
  punch(@Body() dto: PunchDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.attendance.punch(u, dto, meta(req));
  }

  @Post('check-in')
  @HttpCode(200)
  @scanThrottle
  @ApiOperation({ summary: 'Same as scan, forced to check-in.' })
  checkIn(@Body() dto: ScanDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.attendance.scan(u, dto, meta(req), 'check_in');
  }

  @Post('check-out')
  @HttpCode(200)
  @scanThrottle
  @ApiOperation({ summary: 'Same as scan, forced to check-out.' })
  checkOut(@Body() dto: ScanDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.attendance.scan(u, dto, meta(req), 'check_out');
  }

  @Get('today')
  @ApiOperation({ summary: 'My attendance today, schedule and next scan type.' })
  today(@CurrentUser() u: AuthUser) {
    return this.attendance.today(u);
  }

  @Get('history')
  @ApiOperation({ summary: 'Day-by-day history (own; staff may pass employeeId).' })
  history(@Query() q: HistoryQuery, @CurrentUser() u: AuthUser) {
    requireCompany(u);
    return this.attendance.history(u, q);
  }

  @Get('live')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Live attendance for a date: one row per employee with status and location.' })
  live(@Query() q: LiveQuery, @CurrentUser() u: AuthUser) {
    requireCompany(u);
    return this.attendance.live(u, q);
  }

  @Get('records')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Raw attendance records from every source.' })
  records(@Query() q: RecordsQuery, @CurrentUser() u: AuthUser) {
    requireCompany(u);
    return this.attendance.records(u, q);
  }

  @Get('attempts')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Rejected scans (outside area, unknown phone, invalid QR, ...).' })
  attempts(@CurrentUser() u: AuthUser, @Query() q: any) {
    requireCompany(u);
    const date = /^\d{4}-\d{2}-\d{2}$/;
    return this.attendance.attempts(u, {
      from: date.test(q.from) ? q.from : undefined,
      to: date.test(q.to) ? q.to : undefined,
      reason: /^[A-Z_]{2,40}$/.test(q.reason) ? q.reason : undefined,
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 50,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'One attendance record (own, or within the caller\'s scope).' })
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    requireCompany(u);
    return this.attendance.getRecord(u, id);
  }

  @Post(':id/void')
  @Roles(...ADMIN_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Void a wrong record (kept for audit, excluded from results).' })
  voidRecord(@Param('id', uuid) id: string, @Body() dto: VoidDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.attendance.voidRecord(u, id, dto.reason, clientIp(req));
  }
}
