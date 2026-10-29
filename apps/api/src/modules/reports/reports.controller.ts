import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser, requireCompany, Roles, STAFF_ROLES } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { toCsv, toPdf, toXlsx } from './exporters';
import { REPORT_TYPES, ReportQuery, ReportsService, ReportType } from './reports.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(q: Record<string, string>): ReportQuery {
  const pick = (k: string, re: RegExp) => (typeof q[k] === 'string' && re.test(q[k]) ? q[k] : undefined);
  return {
    date: pick('date', DATE), month: pick('month', /^\d{4}-\d{2}$/), from: pick('from', DATE), to: pick('to', DATE),
    departmentId: pick('departmentId', UUID), branchId: pick('branchId', UUID), employeeId: pick('employeeId', UUID),
  };
}

const FORMATS = {
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pdf: { type: 'application/pdf', ext: 'pdf' },
} as const;

@ApiTags('Reports')
@ApiBearerAuth()
@Roles(...STAFF_ROLES)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('export')
  @ApiOperation({ summary: 'Download a report as CSV, Excel or PDF.' })
  @ApiQuery({ name: 'type', enum: REPORT_TYPES })
  @ApiQuery({ name: 'format', enum: Object.keys(FORMATS) })
  async export(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>, @Res() res: Response) {
    requireCompany(u);
    const type = q.type as ReportType;
    const format = FORMATS[q.format as keyof typeof FORMATS];
    if (!REPORT_TYPES.includes(type)) throw badRequest('Unknown report.', 'BAD_REPORT');
    if (!format) throw badRequest('Format must be csv, xlsx or pdf.', 'BAD_FORMAT');
    const report = await this.reports.build(u, type, parse(q));
    const body = q.format === 'csv' ? toCsv(report) : q.format === 'xlsx' ? await toXlsx(report) : await toPdf(report);
    const name = `${type}-${report.subtitle.split(' · ')[0].replace(/[^0-9a-z-]+/gi, '_')}.${format.ext}`;
    res.setHeader('Content-Type', format.type);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(body);
  }

  @Get(':type')
  @ApiOperation({ summary: 'Report as JSON: daily, monthly, employee, department, branch, late, absent, early-leave, overtime, leave, exceptions.' })
  @ApiQuery({ name: 'date', required: false, description: 'daily: YYYY-MM-DD (default today)' })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM (instead of from/to)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  get(@Param('type') type: string, @CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    requireCompany(u);
    return this.reports.build(u, type as ReportType, parse(q));
  }
}
