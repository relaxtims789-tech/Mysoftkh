import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested, IsNotEmpty } from 'class-validator';
import type { Request } from 'express';
import { Db } from '../../database/db.service';
import { AuthUser, clientIp, CurrentUser, Public, requireCompany, Roles } from '../../common/auth';
import { notFound, unauthorized } from '../../common/errors';
import { randomToken, sha256 } from '../../common/crypto';
import { isWorkingDay } from '../../domain/daily-summary';
import { ATTENDANCE_TYPES, AttendanceType, evaluatePunch, resolveScanType, TodayPunch } from '../../domain/punch-rules';
import { localParts } from '../../domain/time';
import { AuditService } from '../audit/audit.service';
import { CompanyContextService } from '../core/company-context.service';

/**
 * Other attendance sources (ZKTeco fingerprint/face terminals via a bridge, face recognition, HR imports) push
 * punches here with a company API key. They land in the same attendance table as QR scans (source column differs).
 */
class PunchDto {
  @ApiProperty({ example: 'E0001' }) @IsString() @IsNotEmpty() @MaxLength(40) employeeCode: string;
  @ApiProperty({ example: '2026-10-06T07:58:12+07:00', description: 'ISO 8601 with offset' }) @IsISO8601({ strict: true }) time: string;
  @ApiPropertyOptional({ enum: ATTENDANCE_TYPES, description: 'Omit to infer (first punch = check-in, later = check-out)' })
  @IsOptional() @IsIn(ATTENDANCE_TYPES as unknown as string[]) type?: AttendanceType;
  @ApiProperty({ example: 'ZK-SN123:45678', description: 'Unique id of this punch at the source; repeats are ignored' }) @IsString() @IsNotEmpty() @MaxLength(120) externalId: string;
  @ApiPropertyOptional({ enum: ['zkteco', 'face', 'import'], default: 'zkteco' }) @IsOptional() @IsIn(['zkteco', 'face', 'import']) source?: 'zkteco' | 'face' | 'import';
  @ApiPropertyOptional({ example: 'PP', description: 'Branch code where the device is' }) @IsOptional() @IsString() @MaxLength(40) branchCode?: string;
  @ApiPropertyOptional({ example: 'fingerprint' }) @IsOptional() @IsString() @MaxLength(40) method?: string;
}

class PunchBatchDto {
  @ApiProperty({ type: [PunchDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => PunchDto) punches: PunchDto[];
}

class KeyDto {
  @ApiProperty({ example: 'ZKTeco bridge - Phnom Penh' }) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
}

@Injectable()
export class IntegrationsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly ctx: CompanyContextService) {}

  listKeys(companyId: string) {
    return this.db.query(
      `SELECT id, name, key_prefix AS "keyPrefix", status, last_used_at AS "lastUsedAt", created_at AS "createdAt" FROM integration_keys WHERE company_id = $1 ORDER BY created_at DESC`,
      [companyId],
    );
  }

  async createKey(companyId: string, name: string, actor: AuthUser, ip: string) {
    const key = `qra_${randomToken(32)}`;
    const r = await this.db.one(
      `INSERT INTO integration_keys (company_id, name, key_prefix, key_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [companyId, name.trim(), key.slice(0, 10), sha256(key), actor.id],
    );
    await this.audit.log({ companyId, userId: actor.id, action: 'create', module: 'integration_keys', recordId: r.id, newValue: { name }, ip });
    return { id: r.id, name, key, note: 'Copy this key now. It is not shown again.' };
  }

  async revokeKey(companyId: string, id: string, actor: AuthUser, ip: string) {
    const r = await this.db.maybeOne(`UPDATE integration_keys SET status = 'revoked' WHERE company_id = $1 AND id = $2 RETURNING id`, [companyId, id]);
    if (!r) throw notFound('API key');
    await this.audit.log({ companyId, userId: actor.id, action: 'revoke', module: 'integration_keys', recordId: id, ip });
    return { ok: true };
  }

  async companyForKey(raw: string | undefined): Promise<string> {
    if (!raw || !raw.startsWith('qra_')) throw unauthorized('Missing or invalid API key.', 'BAD_API_KEY');
    const k = await this.db.maybeOne(
      `SELECT k.id, k.company_id FROM integration_keys k JOIN companies c ON c.id = k.company_id WHERE k.key_hash = $1 AND k.status = 'active' AND c.status = 'active'`,
      [sha256(raw)],
    );
    if (!k) throw unauthorized('Missing or invalid API key.', 'BAD_API_KEY');
    await this.ctx.assertWritable(k.company_id);
    await this.db.query('UPDATE integration_keys SET last_used_at = now() WHERE id = $1', [k.id]);
    return k.company_id;
  }

  /** Stores punches idempotently (company + source + externalId). Unknown employees are reported back, not stored. */
  async ingest(companyId: string, punches: PunchDto[], ip: string) {
    const company = await this.ctx.get(companyId);
    const results: { externalId: string; result: 'created' | 'duplicate' | 'unknown_employee' | 'invalid'; type?: AttendanceType; status?: string }[] = [];
    const sorted = [...punches].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    for (const p of sorted) {
      const time = new Date(p.time);
      if (isNaN(time.getTime()) || time.getTime() > Date.now() + 5 * 60000) {
        results.push({ externalId: p.externalId, result: 'invalid' });
        continue;
      }
      const emp = await this.db.maybeOne(`SELECT id, schedule_id, branch_id FROM employees WHERE company_id = $1 AND lower(employee_code) = lower($2)`, [companyId, p.employeeCode.trim()]);
      if (!emp) {
        results.push({ externalId: p.externalId, result: 'unknown_employee' });
        continue;
      }
      const source = p.source ?? 'zkteco';
      const r = await this.db.tx(async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`scan:${emp.id}`]);
        const exists = await tx.maybeOne('SELECT id FROM attendance WHERE company_id = $1 AND source = $2 AND external_ref = $3', [companyId, source, p.externalId]);
        if (exists) return { result: 'duplicate' as const };
        const local = localParts(time, company.timezone);
        const prior = await tx.query(
          `SELECT attendance_type, scan_time FROM attendance WHERE employee_id = $1 AND work_date = $2 AND NOT is_void AND scan_time < $3 ORDER BY scan_time`,
          [emp.id, local.date, time],
        );
        const today: TodayPunch[] = prior.map((x) => ({ type: x.attendance_type, time: new Date(x.scan_time), minutes: localParts(new Date(x.scan_time), company.timezone).minutes }));
        const schedule = await this.ctx.scheduleFor(companyId, emp.schedule_id, tx);
        const holiday = await this.ctx.holidayName(companyId, local.date, tx);
        const type = p.type ?? resolveScanType(today, local.minutes, schedule, { ...company.rules, allowLunchScan: false });
        const ev = evaluatePunch(type, local.minutes, schedule, company.rules, isWorkingDay({ schedule, weekday: local.weekday, holiday }));
        const branch = p.branchCode ? await tx.maybeOne('SELECT id FROM branches WHERE company_id = $1 AND lower(code) = lower($2)', [companyId, p.branchCode]) : null;
        await tx.query(
          `INSERT INTO attendance (company_id, employee_id, branch_id, attendance_type, scan_time, work_date, source, status, late_minutes, early_minutes, overtime_minutes, remarks, external_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [companyId, emp.id, branch?.id ?? emp.branch_id, type, time, local.date, source, ev.status, ev.lateMinutes, ev.earlyMinutes, ev.overtimeMinutes, p.method ? `Verified by ${p.method}` : null, p.externalId],
        );
        return { result: 'created' as const, type, status: ev.status };
      });
      results.push({ externalId: p.externalId, ...r });
    }
    // Answer in the order the punches were sent.
    const byPunch = new Map(sorted.map((p, i) => [p, results[i]]));
    const ordered = punches.map((p) => byPunch.get(p)!);
    const created = results.filter((r) => r.result === 'created').length;
    if (created) await this.audit.log({ companyId, userId: null, action: 'ingest', module: 'integrations', newValue: { created, received: punches.length }, ip });
    return { received: punches.length, created, results: ordered };
  }
}

const uuid = new ParseUUIDPipe();

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Public()
  @Post('punches')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiOperation({ summary: 'Machine-to-machine: push punches from ZKTeco devices, face recognition or HR systems.' })
  async punches(@Req() req: Request, @Body() dto: PunchBatchDto) {
    const companyId = await this.integrations.companyForKey(req.headers['x-api-key'] as string | undefined);
    return this.integrations.ingest(companyId, dto.punches, clientIp(req));
  }

  @Get('keys')
  @ApiBearerAuth()
  @Roles('super_admin', 'company_admin')
  keys(@CurrentUser() u: AuthUser) {
    return this.integrations.listKeys(requireCompany(u));
  }

  @Post('keys')
  @ApiBearerAuth()
  @Roles('super_admin', 'company_admin')
  createKey(@Body() dto: KeyDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.integrations.createKey(requireCompany(u), dto.name, u, clientIp(req));
  }

  @Post('keys/:id/revoke')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles('super_admin', 'company_admin')
  revokeKey(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.integrations.revokeKey(requireCompany(u), id, u, clientIp(req));
  }
}

@Module({ controllers: [IntegrationsController], providers: [IntegrationsService] })
export class IntegrationsModule {}
