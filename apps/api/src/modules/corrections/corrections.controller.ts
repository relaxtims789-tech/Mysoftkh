import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { ADMIN_ROLES, AuthUser, clientIp, CurrentUser, requireCompany, Roles } from '../../common/auth';
import { ATTENDANCE_TYPES, AttendanceType } from '../../domain/punch-rules';
import { isIsoDate } from '../../domain/time';
import { badRequest } from '../../common/errors';
import { CorrectionsService } from './corrections.service';

const uuid = new ParseUUIDPipe();

class CorrectionDto {
  @ApiPropertyOptional({ description: 'Staff only: the employee to correct' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiProperty({ example: '2026-10-06' }) @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' }) workDate: string;
  @ApiProperty({ enum: ATTENDANCE_TYPES }) @IsIn(ATTENDANCE_TYPES as unknown as string[]) attendanceType: AttendanceType;
  @ApiProperty({ example: '08:03' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Time must be HH:MM' }) time: string;
  @ApiProperty({ example: 'Forgot to scan' }) @IsString() @MinLength(3, { message: 'Please give a reason.' }) @MaxLength(300) reason: string;
}

class ReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

function checkDate(d: string) {
  if (!isIsoDate(d)) throw badRequest('That date is not valid.', 'BAD_DATE');
}

@ApiTags('Attendance corrections')
@ApiBearerAuth()
@Controller('corrections')
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}

  @Get()
  @ApiOperation({ summary: 'Correction requests (employees see their own).' })
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('employeeId') employeeId?: string, @Query('mine') mine?: string) {
    requireCompany(u);
    return this.corrections.list(u, { status, employeeId: employeeId && /^[0-9a-f-]{36}$/i.test(employeeId) ? employeeId : undefined, mine: mine === 'true' });
  }

  @Post()
  @ApiOperation({ summary: 'Request a correction, e.g. a missed check-in.' })
  request(@Body() dto: CorrectionDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    checkDate(dto.workDate);
    return this.corrections.request(u, dto, clientIp(req));
  }

  @Post('manual')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'HR enters a correction directly (requested and approved at once, audited).' })
  manual(@Body() dto: CorrectionDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    checkDate(dto.workDate);
    if (!dto.employeeId) throw badRequest('Choose an employee.', 'EMPLOYEE_REQUIRED');
    return this.corrections.manual(u, dto, clientIp(req));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles(...ADMIN_ROLES)
  approve(@Param('id', uuid) id: string, @Body() dto: ReviewDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.corrections.review(u, id, 'approve', dto.note, clientIp(req));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles(...ADMIN_ROLES)
  reject(@Param('id', uuid) id: string, @Body() dto: ReviewDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.corrections.review(u, id, 'reject', dto.note, clientIp(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.corrections.cancel(u, id, clientIp(req));
  }
}
