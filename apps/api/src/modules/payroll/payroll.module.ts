import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser, clientIp, CurrentUser, isUuid, requireCompany, requireEmployee, Role, Roles } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { isIsoDate } from '../../domain/time';
import { AttendanceModule } from '../attendance/attendance.module';
import { CompanyContextService } from '../core/company-context.service';
import { OvertimeModule } from '../overtime/overtime.module';
import { toCsv, toPdf, toXlsx } from '../reports/exporters';
import { bankReport, payslipsPdf, summaryReport } from './payroll.exports';
import { PayrollService } from './payroll.service';

/** Prepare payroll (calculate drafts, pay items, allowances, advances). */
const PAYROLL_ROLES: Role[] = ['super_admin', 'company_admin', 'hr'];
/** Approve, mark paid, unlock and change payroll settings. */
const LOCK_ROLES: Role[] = ['super_admin', 'company_admin'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TAX = ['salary', 'exempt', 'fringe'] as const;

class BracketDto {
  @ApiPropertyOptional({ example: 2000000, description: 'Upper bound in KHR; null for the last bracket' }) @IsOptional() @IsNumber() @Min(0) upTo: number | null;
  @ApiProperty({ example: 5 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) rate: number;
}

class SettingsDto {
  @IsOptional() @IsIn(['USD', 'KHR', 'THB', 'VND']) currency?: string;
  @IsOptional() @IsBoolean() baseFromAttendance?: boolean;
  @IsOptional() @IsIn(['fixed', 'schedule']) daysBasis?: 'fixed' | 'schedule';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(1) @Max(31) fixedDays?: number;
  @IsOptional() @IsArray() @IsIn(['annual', 'sick', 'personal', 'maternity', 'unpaid', 'other'], { each: true }) unpaidLeaveTypes?: string[];
  @IsOptional() @IsBoolean() lateDeduction?: boolean;
  @IsOptional() @IsIn(['per_minute', 'per_time']) lateMode?: 'per_minute' | 'per_time';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) lateValue?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) lateFree?: number;
  @IsOptional() @IsBoolean() includeEarlyLeave?: boolean;
  @IsOptional() @IsBoolean() overtime?: boolean;
  @IsOptional() @IsBoolean() allowances?: boolean;
  @IsOptional() @IsBoolean() deductions?: boolean;
  @IsOptional() @IsBoolean() tax?: boolean;
  @IsOptional() @IsBoolean() nssf?: boolean;
  @ApiPropertyOptional({ example: 4100, description: 'KHR per USD suggested for new months' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100000) exchangeRate?: number;
  @ApiPropertyOptional({ type: [BracketDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => BracketDto) taxBrackets?: BracketDto[];
  @IsOptional() @IsNumber() @Min(0) @Max(100000000) dependentAllowance?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) nonResidentRate?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) fringeRate?: number;
  @IsOptional() @IsBoolean() pensionDeductible?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) nssfPensionEmployee?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) nssfPensionEmployer?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) nssfHealthEmployer?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) nssfRiskEmployer?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000000000) nssfMinWage?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000000000) nssfMaxWage?: number;
}

class CalculateDto {
  @ApiPropertyOptional({ example: 4100, description: 'KHR per USD for this month' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100000) exchangeRate?: number;
}
class UnlockDto {
  @ApiProperty({ example: 'Missing bonus for sales team' }) @IsString() @MinLength(3) @MaxLength(300) reason: string;
}
class ItemDto {
  @IsUUID() employeeId: string;
  @ApiProperty({ example: '2026-10' }) @Matches(MONTH, { message: 'Month must be YYYY-MM.' }) month: string;
  @ApiProperty({ enum: ['earning', 'deduction'] }) @IsIn(['earning', 'deduction']) kind: 'earning' | 'deduction';
  @ApiProperty({ example: 'Sales commission' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ example: 50 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000000) amount: number;
  @ApiPropertyOptional({ enum: TAX, description: 'Earnings: salary = taxed with salary, exempt = tax-free, fringe = fringe benefit (20%, paid by employer)' })
  @IsOptional() @IsIn(TAX) tax?: (typeof TAX)[number];
}
class AllowanceDto {
  @ApiProperty({ example: 'Transport' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ example: 30 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000000) amount: number;
  @ApiPropertyOptional({ enum: TAX }) @IsOptional() @IsIn(TAX) tax?: (typeof TAX)[number];
}
class AdvanceDto {
  @IsUUID() employeeId: string;
  @ApiProperty({ example: 300 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000000) amount: number;
  @ApiProperty({ example: 100, description: 'Taken from pay each month until repaid' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000000) installment: number;
  @ApiProperty({ example: '2026-10', description: 'First month repaid' }) @Matches(MONTH, { message: 'Month must be YYYY-MM.' }) startMonth: string;
  @ApiProperty({ example: '2026-10-05' }) @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD.' }) issuedOn: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

function month(m: string): string {
  if (!MONTH.test(m || '')) throw badRequest('Month must be YYYY-MM.', 'BAD_MONTH');
  return m;
}

const FORMATS = {
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pdf: { type: 'application/pdf', ext: 'pdf' },
} as const;

function send(res: Response, body: Buffer, format: keyof typeof FORMATS, name: string) {
  res.setHeader('Content-Type', FORMATS[format].type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}.${FORMATS[format].ext}"`);
  res.send(body);
}

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService, private readonly ctx: CompanyContextService) {}

  @Get('settings')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'Payroll options, Tax on Salary brackets and NSSF rates.' })
  settings(@CurrentUser() u: AuthUser) {
    return this.payroll.getSettings(requireCompany(u));
  }

  @Put('settings')
  @Roles(...LOCK_ROLES)
  @ApiOperation({ summary: 'Turn pay items on or off and set tax / NSSF rates (company admin).' })
  updateSettings(@Body() dto: SettingsDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.payroll.updateSettings(requireCompany(u), dto as any, u, clientIp(req));
  }

  @Get('runs')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'Payroll months with status and totals.' })
  runs(@CurrentUser() u: AuthUser) {
    return this.payroll.listRuns(requireCompany(u));
  }

  @Get('runs/:month')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'One month: status, totals and every employee line.' })
  run(@Param('month') m: string, @CurrentUser() u: AuthUser) {
    return this.payroll.getRun(requireCompany(u), month(m));
  }

  @Post('runs/:month/calculate')
  @HttpCode(200)
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'Create or recalculate the draft payroll of a month.' })
  calculate(@Param('month') m: string, @Body() dto: CalculateDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.payroll.calculate(u, month(m), dto.exchangeRate, clientIp(req));
  }

  @Post('runs/:month/approve')
  @HttpCode(200)
  @Roles(...LOCK_ROLES)
  @ApiOperation({ summary: 'Recalculate and lock the month (company admin). Payslips become visible to employees.' })
  approve(@Param('month') m: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.payroll.approve(u, month(m), clientIp(req));
  }

  @Post('runs/:month/paid')
  @HttpCode(200)
  @Roles(...LOCK_ROLES)
  @ApiOperation({ summary: 'Mark an approved month as paid (company admin).' })
  paid(@Param('month') m: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.payroll.markPaid(u, month(m), clientIp(req));
  }

  @Post('runs/:month/unlock')
  @HttpCode(200)
  @Roles(...LOCK_ROLES)
  @ApiOperation({ summary: 'Unlock an approved / paid month back to draft so it can be adjusted (company admin, reason required).' })
  unlock(@Param('month') m: string, @Body() dto: UnlockDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.payroll.unlock(u, month(m), dto.reason, clientIp(req));
  }

  @Delete('runs/:month')
  @Roles(...PAYROLL_ROLES)
  remove(@Param('month') m: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.payroll.deleteRun(u, month(m), clientIp(req));
  }

  @Get('runs/:month/export')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'kind=summary (Excel/CSV/PDF), bank (transfer list) or payslips (PDF; employeeId for one).' })
  async export(@Param('month') m: string, @Query() q: Record<string, string>, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const companyId = requireCompany(u);
    const { run, lines } = await this.payroll.getRun(companyId, month(m));
    const company = await this.ctx.get(companyId);
    if (q.kind === 'payslips') {
      const only = isUuid(q.employeeId) ? lines.filter((l) => l.employeeId === q.employeeId) : lines;
      const name = only.length === 1 ? `payslip-${m}-${only[0].employeeCode.replace(/[^0-9a-z._-]+/gi, '_')}` : `payslips-${m}`;
      return send(res, await payslipsPdf(run, only, company.name), 'pdf', name);
    }
    const format = (q.format || 'xlsx') as keyof typeof FORMATS;
    if (!FORMATS[format]) throw badRequest('Format must be csv, xlsx or pdf.', 'BAD_FORMAT');
    if (q.kind !== 'summary' && q.kind !== 'bank') throw badRequest('kind must be summary, bank or payslips.', 'BAD_KIND');
    const report = q.kind === 'bank' ? bankReport(run, lines, company.name) : summaryReport(run, lines, company.name);
    const body = format === 'csv' ? toCsv(report) : format === 'xlsx' ? await toXlsx(report) : await toPdf(report);
    send(res, body, format, `${q.kind === 'bank' ? 'salary-transfers' : 'payroll'}-${m}`);
  }

  @Get('items')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'One-off earnings and deductions of a month.' })
  items(@Query('month') m: string, @Query('employeeId') employeeId: string | undefined, @CurrentUser() u: AuthUser) {
    return this.payroll.listItems(requireCompany(u), month(m), isUuid(employeeId) ? employeeId : undefined);
  }

  @Post('items')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'Add a bonus, commission, extra allowance or deduction for one month.' })
  addItem(@Body() dto: ItemDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.payroll.addItem(u, dto, clientIp(req));
  }

  @Delete('items/:id')
  @Roles(...PAYROLL_ROLES)
  deleteItem(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    if (!isUuid(id)) throw badRequest('Bad id.', 'BAD_ID');
    return this.payroll.deleteItem(u, id, clientIp(req));
  }

  @Get('employees/:id/allowances')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: "An employee's monthly allowances." })
  allowances(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    if (!isUuid(id)) throw badRequest('Bad id.', 'BAD_ID');
    return this.payroll.listAllowances(requireCompany(u), id);
  }

  @Post('employees/:id/allowances')
  @Roles(...PAYROLL_ROLES)
  addAllowance(@Param('id') id: string, @Body() dto: AllowanceDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    if (!isUuid(id)) throw badRequest('Bad id.', 'BAD_ID');
    return this.payroll.addAllowance(u, id, dto, clientIp(req));
  }

  @Delete('allowances/:id')
  @Roles(...PAYROLL_ROLES)
  deleteAllowance(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    if (!isUuid(id)) throw badRequest('Bad id.', 'BAD_ID');
    return this.payroll.deleteAllowance(u, id, clientIp(req));
  }

  @Get('advances')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'Salary advances with repaid amount and balance.' })
  advances(@Query() q: Record<string, string>, @CurrentUser() u: AuthUser) {
    return this.payroll.listAdvances(requireCompany(u), { employeeId: isUuid(q.employeeId) ? q.employeeId : undefined, status: q.status });
  }

  @Post('advances')
  @Roles(...PAYROLL_ROLES)
  @ApiOperation({ summary: 'Give a salary advance, repaid from pay each month.' })
  addAdvance(@Body() dto: AdvanceDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    if (!isIsoDate(dto.issuedOn)) throw badRequest('That date is not valid.', 'BAD_DATE');
    return this.payroll.addAdvance(u, dto, clientIp(req));
  }

  @Post('advances/:id/cancel')
  @HttpCode(200)
  @Roles(...PAYROLL_ROLES)
  cancelAdvance(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    if (!isUuid(id)) throw badRequest('Bad id.', 'BAD_ID');
    return this.payroll.cancelAdvance(u, id, clientIp(req));
  }

  @Get('mine')
  @ApiOperation({ summary: "Employee: my payslips (approved and paid months)." })
  mine(@CurrentUser() u: AuthUser) {
    requireCompany(u);
    return this.payroll.myPayslips(u);
  }

  @Get('mine/:month')
  @ApiOperation({ summary: 'Employee: one payslip.' })
  mineOne(@Param('month') m: string, @CurrentUser() u: AuthUser) {
    const companyId = requireCompany(u);
    return this.payroll.payslip(companyId, month(m), requireEmployee(u), true);
  }

  @Get('mine/:month/pdf')
  @ApiOperation({ summary: 'Employee: payslip PDF.' })
  async minePdf(@Param('month') m: string, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const companyId = requireCompany(u);
    const { run, line } = await this.payroll.payslip(companyId, month(m), requireEmployee(u), true);
    const company = await this.ctx.get(companyId);
    send(res, await payslipsPdf(run, [line], company.name), 'pdf', `payslip-${m}`);
  }
}

@Module({ imports: [AttendanceModule, OvertimeModule], controllers: [PayrollController], providers: [PayrollService], exports: [PayrollService] })
export class PayrollModule {}
