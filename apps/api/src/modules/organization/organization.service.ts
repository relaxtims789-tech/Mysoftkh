import { Injectable } from '@nestjs/common';
import { addDaysIso, addMonthsIso } from '../../domain/billing';
import { Db } from '../../database/db.service';
import { AuthUser } from '../../common/auth';
import { badRequest, notFound, rethrowUnique } from '../../common/errors';
import { hashPassword, tempPassword } from '../../common/crypto';
import { isValidTimeZone, localParts } from '../../domain/time';
import { AuditService, diff } from '../audit/audit.service';
import { CompanyContextService } from '../core/company-context.service';
import {
  BranchDto, CreateCompanyDto, HolidayDto, NamedDto, ScheduleDto, UpdateBranchDto, UpdateCompanyDto, UpdateRulesDto, UpdateScheduleDto,
} from './organization.dto';
import { PASSWORD_RULE, PASSWORD_RULE_TEXT } from '../auth/auth.dto';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export function mapSchedule(r: any) {
  return {
    id: r.id, name: r.name, startTime: hhmm(r.start_time), endTime: hhmm(r.end_time), lunchStart: hhmm(r.lunch_start),
    lunchEnd: hhmm(r.lunch_end), lateAfterMinutes: r.late_after_minutes, graceMinutes: r.grace_minutes,
    workDays: (r.work_days || []).map(Number), isDefault: r.is_default, status: r.status, employeeCount: r.employee_count ?? undefined,
  };
}

export function mapBranch(r: any) {
  return {
    id: r.id, name: r.name, code: r.code, address: r.address, latitude: r.latitude, longitude: r.longitude, radius: r.radius,
    status: r.status, employeeCount: r.employee_count ?? undefined, activeQrCount: r.active_qr_count ?? undefined, createdAt: r.created_at,
  };
}

const RULE_COLUMNS: Record<keyof UpdateRulesDto, string> = {
  allowLunchScan: 'allow_lunch_scan', requireGps: 'require_gps', requireDeviceBinding: 'require_device_binding',
  deviceApprovalMode: 'device_approval_mode', allowOvertime: 'allow_overtime', overtimeMinMinutes: 'overtime_min_minutes',
  geofenceRadius: 'geofence_radius', maxGpsAccuracy: 'max_gps_accuracy', minScanIntervalSeconds: 'min_scan_interval_seconds',
  restrictToHomeBranch: 'restrict_to_home_branch', allowEmployeeCorrections: 'allow_employee_corrections', allowButtonCheckin: 'allow_button_checkin',
};

@Injectable()
export class OrganizationService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly ctx: CompanyContextService) {}

  // ---------- companies ----------

  async listCompanies() {
    return this.db.query(
      `SELECT c.id, c.name, c.code, c.logo, c.timezone, c.status, c.created_at AS "createdAt",
              (SELECT count(*) FROM employees e WHERE e.company_id = c.id AND e.status = 'active')::int AS "employeeCount",
              (SELECT count(*) FROM branches b WHERE b.company_id = c.id)::int AS "branchCount"
         FROM companies c ORDER BY c.name`,
    );
  }

  async getCompany(id: string) {
    const c = await this.db.maybeOne('SELECT id, name, code, logo, timezone, status, created_at AS "createdAt" FROM companies WHERE id = $1', [id]);
    if (!c) throw notFound('Company');
    return c;
  }

  async createCompany(dto: CreateCompanyDto, actor: AuthUser, ip: string) {
    const tz = dto.timezone || 'Asia/Phnom_Penh';
    if (!isValidTimeZone(tz)) throw badRequest('Unknown time zone.', 'BAD_TIMEZONE');
    const generated = !dto.adminPassword;
    const password = dto.adminPassword || tempPassword();
    if (!generated && !PASSWORD_RULE.test(password)) throw badRequest(PASSWORD_RULE_TEXT, 'WEAK_PASSWORD');
    const hash = await hashPassword(password);
    try {
      return await this.db.tx(async (tx) => {
        const c = await tx.one(`INSERT INTO companies (name, code, timezone) VALUES ($1, $2, $3) RETURNING id, name, code, timezone, status`, [dto.name.trim(), dto.code.toLowerCase(), tz]);
        await tx.query('INSERT INTO attendance_rules (company_id) VALUES ($1)', [c.id]);
        await tx.query(
          `INSERT INTO work_schedules (company_id, name, start_time, end_time, lunch_start, lunch_end, is_default) VALUES ($1, 'Office hours', '08:00', '17:00', '12:00', '13:00', true)`,
          [c.id],
        );
        // Free trial like a website sign-up, unless the super admin marks the company free.
        const trialMonths = (await tx.one('SELECT trial_months FROM platform_settings WHERE id = 1')).trial_months;
        const today = localParts(new Date(), tz).date;
        await tx.query(
          `UPDATE companies SET billing_exempt = $2, trial_ends_at = $3, tier_id = CASE WHEN $2 THEN NULL ELSE (SELECT id FROM price_tiers WHERE active ORDER BY max_staff LIMIT 1) END WHERE id = $1`,
          [c.id, !!dto.free, dto.free ? null : addDaysIso(addMonthsIso(today, trialMonths), -1)],
        );
        const admin = await tx.one(
          `INSERT INTO users (company_id, username, email, name, role, password_hash, must_change_password)
           VALUES ($1, $2, $2, $3, 'company_admin', $4, true) RETURNING id, email`,
          [c.id, dto.adminEmail.toLowerCase(), dto.adminName.trim(), hash],
        );
        await this.audit.log({ companyId: c.id, userId: actor.id, action: 'create', module: 'companies', recordId: c.id, newValue: { ...c, adminEmail: admin.email }, ip }, tx);
        return { company: c, admin: { email: admin.email, temporaryPassword: generated ? password : undefined } };
      });
    } catch (e) {
      rethrowUnique(e, 'That company code or admin email is already used.');
    }
  }

  async updateCompany(id: string, dto: UpdateCompanyDto, actor: AuthUser, ip: string) {
    const before = await this.db.maybeOne('SELECT name, code, timezone, status FROM companies WHERE id = $1', [id]);
    if (!before) throw notFound('Company');
    if (dto.timezone && !isValidTimeZone(dto.timezone)) throw badRequest('Unknown time zone.', 'BAD_TIMEZONE');
    const next = {
      name: dto.name?.trim() ?? before.name,
      code: dto.code?.toLowerCase() ?? before.code,
      timezone: dto.timezone ?? before.timezone,
      status: actor.role === 'super_admin' ? (dto.status ?? before.status) : before.status,
    };
    try {
      await this.db.query('UPDATE companies SET name = $2, code = $3, timezone = $4, status = $5, updated_at = now() WHERE id = $1', [id, next.name, next.code, next.timezone, next.status]);
    } catch (e) {
      rethrowUnique(e, 'That company code is already used.');
    }
    const d = diff(before, next);
    await this.audit.log({ companyId: id, userId: actor.id, action: 'update', module: 'companies', recordId: id, oldValue: d.old, newValue: d.new, ip });
    return this.getCompany(id);
  }

  async setLogo(companyId: string, url: string, actor: AuthUser, ip: string) {
    const before = await this.db.one('SELECT logo FROM companies WHERE id = $1', [companyId]);
    await this.db.query('UPDATE companies SET logo = $2, updated_at = now() WHERE id = $1', [companyId, url]);
    await this.audit.log({ companyId, userId: actor.id, action: 'update_logo', module: 'companies', recordId: companyId, oldValue: before, newValue: { logo: url }, ip });
    return before.logo as string | null;
  }

  // ---------- attendance rules ----------

  async getRules(companyId: string) {
    return (await this.ctx.get(companyId)).rules;
  }

  async updateRules(companyId: string, dto: UpdateRulesDto, actor: AuthUser, ip: string) {
    const before = await this.getRules(companyId);
    const sets: string[] = [];
    const params: unknown[] = [companyId];
    for (const [key, col] of Object.entries(RULE_COLUMNS)) {
      const v = (dto as any)[key];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length) {
      await this.db.query(`INSERT INTO attendance_rules (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING`, [companyId]);
      await this.db.query(`UPDATE attendance_rules SET ${sets.join(', ')}, updated_at = now() WHERE company_id = $1`, params);
    }
    const after = await this.getRules(companyId);
    const d = diff(before, after);
    await this.audit.log({ companyId, userId: actor.id, action: 'update', module: 'attendance_rules', recordId: companyId, oldValue: d.old, newValue: d.new, ip });
    return after;
  }

  // ---------- branches ----------

  async listBranches(companyId: string) {
    const rows = await this.db.query(
      `SELECT b.*,
              (SELECT count(*) FROM employees e WHERE e.branch_id = b.id AND e.status = 'active')::int AS employee_count,
              (SELECT count(*) FROM qr_codes q WHERE q.branch_id = b.id AND q.status = 'active')::int AS active_qr_count
         FROM branches b WHERE b.company_id = $1 ORDER BY b.status, b.name`,
      [companyId],
    );
    return rows.map(mapBranch);
  }

  async getBranch(companyId: string, id: string) {
    const r = await this.db.maybeOne('SELECT * FROM branches WHERE company_id = $1 AND id = $2', [companyId, id]);
    if (!r) throw notFound('Branch');
    return mapBranch(r);
  }

  async createBranch(companyId: string, dto: BranchDto, actor: AuthUser, ip: string) {
    if ((dto.status ?? 'active') === 'active') await this.ctx.assertBranchLimit(companyId, 1);
    try {
      const r = await this.db.one(
        `INSERT INTO branches (company_id, name, code, address, latitude, longitude, radius, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [companyId, dto.name.trim(), dto.code.toUpperCase(), dto.address ?? null, dto.latitude, dto.longitude, dto.radius ?? null, dto.status ?? 'active'],
      );
      await this.audit.log({ companyId, userId: actor.id, action: 'create', module: 'branches', recordId: r.id, newValue: mapBranch(r), ip });
      return mapBranch(r);
    } catch (e) {
      rethrowUnique(e, 'A branch with that code already exists.');
    }
  }

  branchAllowance(companyId: string) {
    return this.ctx.branchAllowance(companyId);
  }

  async updateBranch(companyId: string, id: string, dto: UpdateBranchDto, actor: AuthUser, ip: string) {
    const before = await this.getBranch(companyId, id);
    const next = {
      name: dto.name?.trim() ?? before.name,
      code: dto.code?.toUpperCase() ?? before.code,
      address: dto.address !== undefined ? dto.address : before.address,
      latitude: dto.latitude ?? before.latitude,
      longitude: dto.longitude ?? before.longitude,
      radius: dto.radius !== undefined ? dto.radius : before.radius,
      status: dto.status ?? before.status,
    };
    if (before.status !== 'active' && next.status === 'active') await this.ctx.assertBranchLimit(companyId, 1);
    try {
      await this.db.query(
        `UPDATE branches SET name = $3, code = $4, address = $5, latitude = $6, longitude = $7, radius = $8, status = $9, updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [companyId, id, next.name, next.code, next.address, next.latitude, next.longitude, next.radius, next.status],
      );
    } catch (e) {
      rethrowUnique(e, 'A branch with that code already exists.');
    }
    const d = diff(before, next);
    await this.audit.log({ companyId, userId: actor.id, action: 'update', module: 'branches', recordId: id, oldValue: d.old, newValue: d.new, ip });
    return this.getBranch(companyId, id);
  }

  // ---------- departments & positions ----------

  async listNamed(table: 'departments' | 'positions', companyId: string) {
    const fk = table === 'departments' ? 'department_id' : 'position_id';
    return this.db.query(
      `SELECT t.id, t.name, t.status, (SELECT count(*) FROM employees e WHERE e.${fk} = t.id AND e.status = 'active')::int AS "employeeCount"
         FROM ${table} t WHERE t.company_id = $1 ORDER BY t.status, t.name`,
      [companyId],
    );
  }

  async saveNamed(table: 'departments' | 'positions', companyId: string, id: string | null, dto: NamedDto, actor: AuthUser, ip: string) {
    try {
      if (!id) {
        const r = await this.db.one(`INSERT INTO ${table} (company_id, name, status) VALUES ($1, $2, $3) RETURNING id, name, status`, [companyId, dto.name.trim(), dto.status ?? 'active']);
        await this.audit.log({ companyId, userId: actor.id, action: 'create', module: table, recordId: r.id, newValue: r, ip });
        return r;
      }
      const before = await this.db.maybeOne(`SELECT id, name, status FROM ${table} WHERE company_id = $1 AND id = $2`, [companyId, id]);
      if (!before) throw notFound(table === 'departments' ? 'Department' : 'Position');
      const r = await this.db.one(`UPDATE ${table} SET name = $3, status = $4 WHERE company_id = $1 AND id = $2 RETURNING id, name, status`, [companyId, id, dto.name.trim(), dto.status ?? before.status]);
      const d = diff(before, r);
      await this.audit.log({ companyId, userId: actor.id, action: 'update', module: table, recordId: id, oldValue: d.old, newValue: d.new, ip });
      return r;
    } catch (e) {
      rethrowUnique(e, `That name is already used.`);
    }
  }

  async deleteNamed(table: 'departments' | 'positions', companyId: string, id: string, actor: AuthUser, ip: string) {
    const r = await this.db.maybeOne(`DELETE FROM ${table} WHERE company_id = $1 AND id = $2 RETURNING id, name`, [companyId, id]);
    if (!r) throw notFound(table === 'departments' ? 'Department' : 'Position');
    await this.audit.log({ companyId, userId: actor.id, action: 'delete', module: table, recordId: id, oldValue: r, ip });
    return { ok: true };
  }

  // ---------- work schedules ----------

  async listSchedules(companyId: string) {
    const rows = await this.db.query(
      `SELECT s.*, (SELECT count(*) FROM employees e WHERE e.status = 'active' AND (e.schedule_id = s.id OR (e.schedule_id IS NULL AND s.is_default)) AND e.company_id = s.company_id)::int AS employee_count
         FROM work_schedules s WHERE s.company_id = $1 ORDER BY s.is_default DESC, s.name`,
      [companyId],
    );
    return rows.map(mapSchedule);
  }

  private checkSchedule(s: { startTime: string; endTime: string; lunchStart?: string | null; lunchEnd?: string | null }) {
    if (s.endTime <= s.startTime) throw badRequest('End time must be after start time (overnight shifts are not supported yet).', 'BAD_SCHEDULE');
    if (!!s.lunchStart !== !!s.lunchEnd) throw badRequest('Set both lunch start and lunch end, or neither.', 'BAD_SCHEDULE');
    if (s.lunchStart && s.lunchEnd && (s.lunchEnd <= s.lunchStart || s.lunchStart < s.startTime || s.lunchEnd > s.endTime)) {
      throw badRequest('Lunch must be inside working hours.', 'BAD_SCHEDULE');
    }
  }

  async saveSchedule(companyId: string, id: string | null, dto: ScheduleDto | UpdateScheduleDto, actor: AuthUser, ip: string) {
    const before = id ? (await this.listSchedules(companyId)).find((s) => s.id === id) : null;
    if (id && !before) throw notFound('Schedule');
    const next = {
      name: dto.name?.trim() ?? before!.name,
      startTime: dto.startTime ?? before!.startTime!,
      endTime: dto.endTime ?? before!.endTime!,
      lunchStart: dto.lunchStart !== undefined ? dto.lunchStart || null : before?.lunchStart ?? null,
      lunchEnd: dto.lunchEnd !== undefined ? dto.lunchEnd || null : before?.lunchEnd ?? null,
      lateAfterMinutes: dto.lateAfterMinutes ?? before!.lateAfterMinutes,
      graceMinutes: dto.graceMinutes ?? before!.graceMinutes,
      workDays: [...new Set(dto.workDays ?? before!.workDays)].sort(),
      isDefault: dto.isDefault ?? before?.isDefault ?? false,
      status: dto.status ?? before?.status ?? 'active',
    };
    this.checkSchedule(next);
    return this.db.tx(async (tx) => {
      if (next.isDefault) await tx.query('UPDATE work_schedules SET is_default = false WHERE company_id = $1 AND is_default AND id IS DISTINCT FROM $2', [companyId, id]);
      const params = [companyId, next.name, next.startTime, next.endTime, next.lunchStart, next.lunchEnd, next.lateAfterMinutes, next.graceMinutes, next.workDays, next.isDefault, next.status];
      const r = id
        ? await tx.one(
            `UPDATE work_schedules SET name = $2, start_time = $3, end_time = $4, lunch_start = $5, lunch_end = $6, late_after_minutes = $7,
                    grace_minutes = $8, work_days = $9, is_default = $10, status = $11 WHERE company_id = $1 AND id = $12 RETURNING *`,
            [...params, id],
          )
        : await tx.one(
            `INSERT INTO work_schedules (company_id, name, start_time, end_time, lunch_start, lunch_end, late_after_minutes, grace_minutes, work_days, is_default, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            params,
          );
      const d = before ? diff(before, next) : { old: null, new: next };
      await this.audit.log({ companyId, userId: actor.id, action: id ? 'update' : 'create', module: 'work_schedules', recordId: r.id, oldValue: d.old, newValue: d.new, ip }, tx);
      return mapSchedule(r);
    });
  }

  // ---------- holidays ----------

  async listHolidays(companyId: string, year?: number) {
    return this.db.query(
      `SELECT id, name, date FROM holidays WHERE company_id = $1 AND ($2::int IS NULL OR extract(year FROM date) = $2) ORDER BY date`,
      [companyId, year ?? null],
    );
  }

  async createHoliday(companyId: string, dto: HolidayDto, actor: AuthUser, ip: string) {
    try {
      const r = await this.db.one('INSERT INTO holidays (company_id, name, date) VALUES ($1, $2, $3) RETURNING id, name, date', [companyId, dto.name.trim(), dto.date]);
      await this.audit.log({ companyId, userId: actor.id, action: 'create', module: 'holidays', recordId: r.id, newValue: r, ip });
      return r;
    } catch (e) {
      if ((e as any)?.code === '22008' || (e as any)?.code === '22007') throw badRequest('That date is not valid.', 'BAD_DATE');
      rethrowUnique(e, 'There is already a holiday on that date.');
    }
  }

  async deleteHoliday(companyId: string, id: string, actor: AuthUser, ip: string) {
    const r = await this.db.maybeOne('DELETE FROM holidays WHERE company_id = $1 AND id = $2 RETURNING id, name, date', [companyId, id]);
    if (!r) throw notFound('Holiday');
    await this.audit.log({ companyId, userId: actor.id, action: 'delete', module: 'holidays', recordId: id, oldValue: r, ip });
    return { ok: true };
  }
}
