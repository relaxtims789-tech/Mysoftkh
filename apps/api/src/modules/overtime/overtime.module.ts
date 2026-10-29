import { Body, Controller, Get, HttpCode, Module, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { AuthUser, clientIp, CurrentUser, requireCompany, Roles, STAFF_ROLES } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { isIsoDate, addDays, daysBetween } from '../../domain/time';
import { AttendanceModule } from '../attendance/attendance.module';
import { CompanyContextService } from '../core/company-context.service';
import { OvertimeService } from './overtime.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class WorkDayRuleDto {
  @ApiProperty({ enum: ['multiplier', 'fixed_hour'] }) @IsIn(['multiplier', 'fixed_hour']) mode: 'multiplier' | 'fixed_hour';
  @ApiProperty({ example: 1.5, description: 'Multiplier of the hourly rate, or an amount per hour' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) value: number;
}
class DayRuleDto {
  @ApiProperty({ enum: ['multiplier', 'fixed_hour', 'fixed_day'] }) @IsIn(['multiplier', 'fixed_hour', 'fixed_day']) mode: 'multiplier' | 'fixed_hour' | 'fixed_day';
  @ApiProperty({ example: 2 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000000) value: number;
  @ApiPropertyOptional({ example: 4, description: 'fixed_day: minimum hours worked for the day to be paid' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(24) minHours?: number;
}
class PolicyDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @ApiPropertyOptional({ enum: ['USD', 'KHR', 'THB', 'VND'] }) @IsOptional() @IsIn(['USD', 'KHR', 'THB', 'VND']) currency?: string;
  @ApiPropertyOptional({ example: 208, description: 'Monthly salary / this = hourly rate' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(400) monthlyHours?: number;
  @ApiPropertyOptional({ type: WorkDayRuleDto }) @IsOptional() @ValidateNested() @Type(() => WorkDayRuleDto) workDay?: WorkDayRuleDto;
  @ApiPropertyOptional({ type: DayRuleDto }) @IsOptional() @ValidateNested() @Type(() => DayRuleDto) dayOff?: DayRuleDto;
  @ApiPropertyOptional({ type: DayRuleDto }) @IsOptional() @ValidateNested() @Type(() => DayRuleDto) holiday?: DayRuleDto;
}
class ReviewItemDto {
  @IsUUID() employeeId: string;
  @Matches(DATE) workDate: string;
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject';
  @IsOptional() @IsInt() @Min(0) @Max(1440) minutes?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class ReviewDto {
  @ApiProperty({ type: [ReviewItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReviewItemDto) items: ReviewItemDto[];
}
class ReasonDto {
  @ApiProperty({ example: '2026-10-06' }) @Matches(DATE) workDate: string;
  @ApiProperty({ example: 'Finishing the stock count' }) @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

const UUID = /^[0-9a-f-]{36}$/i;

@ApiTags('Overtime')
@ApiBearerAuth()
@Controller('overtime')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService, private readonly ctx: CompanyContextService) {}

  private async range(u: AuthUser, from?: string, to?: string) {
    const company = await this.ctx.get(requireCompany(u));
    const today = this.ctx.now(company.timezone).date;
    const f = from && DATE.test(from) && isIsoDate(from) ? from : `${today.slice(0, 7)}-01`;
    const t = to && DATE.test(to) && isIsoDate(to) ? to : today;
    if (f > t) throw badRequest('"From" must be on or before "to".', 'BAD_RANGE');
    if (daysBetween(f, t) > 370) throw badRequest('Choose a range of at most one year.', 'BAD_RANGE');
    return { from: f, to: t > today ? today : t, today };
  }

  @Get('policy')
  @ApiOperation({ summary: 'Overtime pay rates and whether approval is required.' })
  policy(@CurrentUser() u: AuthUser) {
    return this.overtime.getPolicy(requireCompany(u));
  }

  @Put('policy')
  @Roles('super_admin', 'company_admin')
  @ApiOperation({ summary: 'Set overtime rates (per hour on work days; per hour or per day on days off and holidays) and approval.' })
  updatePolicy(@Body() dto: PolicyDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.overtime.updatePolicy(requireCompany(u), dto, u, clientIp(req));
  }

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Days with overtime (status: pending, approved, rejected, not_required) with hours and pay.' })
  async list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    const { from, to } = await this.range(u, q.from, q.to);
    return this.overtime.days(u, from, to, q.status, {
      departmentId: UUID.test(q.departmentId || '') ? q.departmentId : undefined,
      branchId: UUID.test(q.branchId || '') ? q.branchId : undefined,
      employeeId: UUID.test(q.employeeId || '') ? q.employeeId : undefined,
    });
  }

  @Get('pending-count')
  @Roles(...STAFF_ROLES)
  pending(@CurrentUser() u: AuthUser) {
    requireCompany(u);
    return this.overtime.pendingCount(u).then((n) => ({ pending: n }));
  }

  @Post('review')
  @HttpCode(200)
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Approve (all or fewer minutes) or reject overtime days, one or many at once.' })
  review(@Body() dto: ReviewDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.overtime.review(u, dto.items, clientIp(req));
  }

  @Get('mine')
  @ApiOperation({ summary: "The signed-in employee's overtime days and their approval status." })
  async mine(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = await this.range(u, from, to ?? addDays(new Date().toISOString().slice(0, 10), 1));
    return this.overtime.mine(u, r.from, r.to);
  }

  @Post('reason')
  @HttpCode(200)
  @ApiOperation({ summary: 'Employee: explain the overtime of a day.' })
  reason(@Body() dto: ReasonDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    if (!isIsoDate(dto.workDate)) throw badRequest('That date is not valid.', 'BAD_DATE');
    return this.overtime.reason(u, dto.workDate, dto.reason, clientIp(req));
  }
}

@Module({ imports: [AttendanceModule], controllers: [OvertimeController], providers: [OvertimeService], exports: [OvertimeService] })
export class OvertimeModule {}
