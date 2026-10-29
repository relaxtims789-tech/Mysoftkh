import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../../database/db.service';
import { AuthUser } from '../../common/auth';
import { badRequest, notFound, rethrowUnique } from '../../common/errors';
import { escapeLike, pageParams, scopeEmployees, Where } from '../../common/sql';
import { hashPassword, tempPassword } from '../../common/crypto';
import { normalizePhone } from '../../common/phone';
import { AuditService, diff } from '../audit/audit.service';
import { CompanyContextService } from '../core/company-context.service';
import { AuthService } from '../auth/auth.service';
import { PASSWORD_RULE, PASSWORD_RULE_TEXT } from '../auth/auth.dto';
import { EMPLOYEE_CODE, EmployeeDto, EmployeeQuery, ImportEmployeesDto, UpdateEmployeeDto } from './employees.dto';

const PAY_FIELDS = ['monthlySalary', 'hourlyRate', 'dependents', 'taxResident', 'nssfEnrolled', 'bankName', 'bankAccount', 'bankAccountName'] as const;

/** Salary, tax and bank details are for admins and HR; managers never receive them. */
export function hidePay<T extends { monthlySalary?: unknown; hourlyRate?: unknown }>(e: T, user?: AuthUser | null): T {
  if (user?.role !== 'manager') return e;
  const copy: any = { ...e };
  for (const k of PAY_FIELDS) copy[k] = undefined;
  return copy;
}

export function mapEmployee(r: any) {
  return {
    id: r.id,
    employeeCode: r.employee_code,
    name: r.name,
    phone: r.phone,
    email: r.email,
    departmentId: r.department_id,
    department: r.department_name ?? null,
    positionId: r.position_id,
    position: r.position_name ?? null,
    branchId: r.branch_id,
    branch: r.branch_name ?? null,
    scheduleId: r.schedule_id,
    schedule: r.schedule_name ?? null,
    status: r.status,
    profilePhoto: r.profile_photo,
    hiredOn: r.hired_on,
    monthlySalary: r.monthly_salary ?? null,
    hourlyRate: r.hourly_rate ?? null,
    dependents: r.dependents ?? 0,
    taxResident: r.tax_resident ?? true,
    nssfEnrolled: r.nssf_enrolled ?? true,
    bankName: r.bank_name ?? null,
    bankAccount: r.bank_account ?? null,
    bankAccountName: r.bank_account_name ?? null,
    device: r.device_status ? { status: r.device_status, name: r.device_name, lastUsedAt: r.device_last_used } : null,
    pendingDevices: r.pending_devices ?? 0,
    createdAt: r.created_at,
  };
}

const SELECT = `
  SELECT e.*, d.name AS department_name, p.name AS position_name, b.name AS branch_name, s.name AS schedule_name,
         dv.status AS device_status, dv.device_name, dv.last_used_at AS device_last_used,
         (SELECT count(*) FROM devices x WHERE x.employee_id = e.id AND x.status = 'pending')::int AS pending_devices
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN positions p ON p.id = e.position_id
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN work_schedules s ON s.id = e.schedule_id
    LEFT JOIN LATERAL (SELECT status, device_name, last_used_at FROM devices v WHERE v.employee_id = e.id AND v.status = 'active'
                        ORDER BY v.last_used_at DESC NULLS LAST LIMIT 1) dv ON true`;

@Injectable()
export class EmployeesService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly auth: AuthService, private readonly ctx: CompanyContextService) {}

  async list(companyId: string, user: AuthUser, q: EmployeeQuery) {
    const w = new Where().add('e.company_id = ?', companyId);
    scopeEmployees(w, user);
    if (q.status !== 'all') w.add('e.status = ?', q.status || 'active');
    w.addIf(q.departmentId, 'e.department_id = ?');
    w.addIf(q.branchId, 'e.branch_id = ?');
    if (q.search?.trim()) {
      const like = `%${escapeLike(q.search.trim())}%`;
      w.add('(e.name ILIKE ? OR e.employee_code ILIKE ? OR e.phone ILIKE ? OR e.email ILIKE ?)', like, like, like, like);
    }
    const { limit, offset, page, pageSize } = pageParams(q, 1000);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM employees e ${w}`, w.params)).n;
    const rows = await this.db.query(`${SELECT} ${w} ORDER BY e.employee_code LIMIT ${limit} OFFSET ${offset}`, w.params);
    return { items: rows.map((r) => hidePay(mapEmployee(r), user)), total, page, pageSize };
  }

  async get(companyId: string, id: string, user?: AuthUser) {
    const w = new Where().add('e.company_id = ?', companyId).add('e.id = ?', id);
    if (user) scopeEmployees(w, user);
    const r = await this.db.maybeOne(`${SELECT} ${w}`, w.params);
    if (!r) throw notFound('Employee');
    const login = await this.db.maybeOne('SELECT id, username, role, status, must_change_password AS "mustChangePassword", last_login_at AS "lastLoginAt" FROM users WHERE employee_id = $1', [id]);
    const devices = await this.db.query(
      `SELECT id, device_name AS "deviceName", platform, status, registered_at AS "registeredAt", approved_at AS "approvedAt", last_used_at AS "lastUsedAt"
         FROM devices WHERE employee_id = $1 ORDER BY registered_at DESC`,
      [id],
    );
    return { ...hidePay(mapEmployee(r), user), login, devices };
  }

  /** Company-owned reference ids must belong to the same company (never trust ids from the client). */
  private async checkRefs(companyId: string, dto: Partial<EmployeeDto>, tx: Queryable = this.db) {
    const checks: [string | null | undefined, string, string][] = [
      [dto.departmentId, 'departments', 'Department'],
      [dto.positionId, 'positions', 'Position'],
      [dto.branchId, 'branches', 'Branch'],
      [dto.scheduleId, 'work_schedules', 'Schedule'],
    ];
    for (const [id, table, label] of checks) {
      if (!id) continue;
      const ok = await tx.maybeOne(`SELECT 1 FROM ${table} WHERE company_id = $1 AND id = $2`, [companyId, id]);
      if (!ok) throw badRequest(`${label} not found.`, 'BAD_REFERENCE');
    }
  }

  async create(companyId: string, dto: EmployeeDto, actor: AuthUser, ip: string) {
    await this.checkRefs(companyId, dto);
    if ((dto.status ?? 'active') === 'active') await this.ctx.assertStaffLimit(companyId, 1);
    const generated = !dto.password;
    const password = dto.password || tempPassword();
    if (!generated && !PASSWORD_RULE.test(password)) throw badRequest(PASSWORD_RULE_TEXT, 'WEAK_PASSWORD');
    const hash = await hashPassword(password);
    try {
      const id = await this.db.tx(async (tx) => {
        const e = await tx.one(
          `INSERT INTO employees (company_id, employee_code, name, phone, email, department_id, position_id, branch_id, schedule_id, hired_on, status, monthly_salary, hourly_rate,
                                  dependents, tax_resident, nssf_enrolled, bank_name, bank_account, bank_account_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
          [companyId, dto.employeeCode.trim(), dto.name.trim(), dto.phone || null, dto.email?.toLowerCase() || null, dto.departmentId || null,
            dto.positionId || null, dto.branchId || null, dto.scheduleId || null, dto.hiredOn || null, dto.status ?? 'active', dto.monthlySalary ?? null, dto.hourlyRate ?? null,
            dto.dependents ?? 0, dto.taxResident ?? true, dto.nssfEnrolled ?? true, dto.bankName?.trim() || null, dto.bankAccount?.trim() || null, dto.bankAccountName?.trim() || null],
        );
        await tx.query(
          `INSERT INTO users (company_id, employee_id, username, name, role, password_hash, must_change_password, status, phone, phone_norm)
           VALUES ($1, $2, $3, $4, 'employee', $5, true, $6, $7, $8)`,
          [companyId, e.id, e.employee_code, e.name, hash, e.status === 'active' ? 'active' : 'disabled', e.phone, normalizePhone(e.phone)],
        );
        await this.audit.log({ companyId, userId: actor.id, action: 'create', module: 'employees', recordId: e.id, newValue: mapEmployee(e), ip }, tx);
        return e.id as string;
      });
      return { employee: await this.get(companyId, id), login: { companyCode: await this.companyCode(companyId), username: dto.employeeCode.trim(), temporaryPassword: generated ? password : undefined } };
    } catch (e) {
      rethrowUnique(e, 'An employee with that ID already exists.');
    }
  }

  private async companyCode(companyId: string) {
    return (await this.db.one('SELECT code FROM companies WHERE id = $1', [companyId])).code;
  }

  async update(companyId: string, id: string, dto: UpdateEmployeeDto, actor: AuthUser, ip: string) {
    const before = await this.get(companyId, id);
    await this.checkRefs(companyId, dto);
    if (before.status !== 'active' && dto.status === 'active') await this.ctx.assertStaffLimit(companyId, 1);
    const pick = <K extends keyof UpdateEmployeeDto>(k: K, cur: any) => (dto[k] !== undefined ? dto[k] || null : cur);
    const next = {
      employeeCode: dto.employeeCode?.trim() ?? before.employeeCode,
      name: dto.name?.trim() ?? before.name,
      phone: pick('phone', before.phone),
      email: dto.email !== undefined ? dto.email?.toLowerCase() || null : before.email,
      departmentId: pick('departmentId', before.departmentId),
      positionId: pick('positionId', before.positionId),
      branchId: pick('branchId', before.branchId),
      scheduleId: pick('scheduleId', before.scheduleId),
      hiredOn: pick('hiredOn', before.hiredOn),
      monthlySalary: dto.monthlySalary !== undefined ? dto.monthlySalary : before.monthlySalary,
      hourlyRate: dto.hourlyRate !== undefined ? dto.hourlyRate : before.hourlyRate,
      dependents: dto.dependents ?? before.dependents,
      taxResident: dto.taxResident ?? before.taxResident,
      nssfEnrolled: dto.nssfEnrolled ?? before.nssfEnrolled,
      bankName: dto.bankName !== undefined ? dto.bankName?.trim() || null : before.bankName,
      bankAccount: dto.bankAccount !== undefined ? dto.bankAccount?.trim() || null : before.bankAccount,
      bankAccountName: dto.bankAccountName !== undefined ? dto.bankAccountName?.trim() || null : before.bankAccountName,
      status: dto.status ?? before.status,
    };
    try {
      await this.db.tx(async (tx) => {
        await tx.query(
          `UPDATE employees SET employee_code = $3, name = $4, phone = $5, email = $6, department_id = $7, position_id = $8, branch_id = $9,
                  schedule_id = $10, hired_on = $11, status = $12, monthly_salary = $13, hourly_rate = $14,
                  dependents = $15, tax_resident = $16, nssf_enrolled = $17, bank_name = $18, bank_account = $19, bank_account_name = $20, updated_at = now()
            WHERE company_id = $1 AND id = $2`,
          [companyId, id, next.employeeCode, next.name, next.phone, next.email, next.departmentId, next.positionId, next.branchId, next.scheduleId, next.hiredOn, next.status, next.monthlySalary, next.hourlyRate,
            next.dependents, next.taxResident, next.nssfEnrolled, next.bankName, next.bankAccount, next.bankAccountName],
        );
        // Employee-role logins follow the employee ID, phone and status; staff logins keep their own username and phone.
        await tx.query(
          `UPDATE users SET name = $2, username = CASE WHEN role = 'employee' THEN $3 ELSE username END,
                  phone = CASE WHEN role = 'employee' THEN $5 ELSE phone END, phone_norm = CASE WHEN role = 'employee' THEN $6 ELSE phone_norm END,
                  status = CASE WHEN $4 = 'active' THEN status ELSE 'disabled' END, updated_at = now()
            WHERE employee_id = $1`,
          [id, next.name, next.employeeCode, next.status, next.phone, normalizePhone(next.phone)],
        );
        if (before.status === 'inactive' && next.status === 'active') {
          await tx.query(`UPDATE users SET status = 'active' WHERE employee_id = $1 AND role = 'employee'`, [id]);
        }
        const d = diff(
          { employeeCode: before.employeeCode, name: before.name, phone: before.phone, email: before.email, departmentId: before.departmentId, positionId: before.positionId, branchId: before.branchId, scheduleId: before.scheduleId, hiredOn: before.hiredOn, status: before.status, monthlySalary: before.monthlySalary, hourlyRate: before.hourlyRate,
            dependents: before.dependents, taxResident: before.taxResident, nssfEnrolled: before.nssfEnrolled, bankName: before.bankName, bankAccount: before.bankAccount, bankAccountName: before.bankAccountName },
          next,
        );
        await this.audit.log({ companyId, userId: actor.id, action: 'update', module: 'employees', recordId: id, oldValue: d.old, newValue: d.new, ip }, tx);
      });
    } catch (e) {
      rethrowUnique(e, 'An employee with that ID already exists.');
    }
    if (next.status !== 'active') await this.revokeSessions(id);
    return this.get(companyId, id);
  }

  /** Disables the employee (attendance history is kept). */
  async disable(companyId: string, id: string, actor: AuthUser, ip: string) {
    await this.update(companyId, id, { status: 'inactive' }, actor, ip);
    return { ok: true };
  }

  private async revokeSessions(employeeId: string) {
    const u = await this.db.maybeOne('SELECT id FROM users WHERE employee_id = $1', [employeeId]);
    if (u) await this.auth.revokeAll(u.id);
  }

  async resetPassword(companyId: string, id: string, actor: AuthUser, ip: string) {
    const emp = await this.get(companyId, id);
    if (!emp.login) throw notFound('Login');
    const password = tempPassword();
    await this.db.query('UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [emp.login.id, await hashPassword(password)]);
    await this.auth.revokeAll(emp.login.id);
    await this.audit.log({ companyId, userId: actor.id, action: 'reset_password', module: 'employees', recordId: id, ip });
    return { username: emp.login.username, companyCode: await this.companyCode(companyId), temporaryPassword: password };
  }

  /** Removes the registered phone(s); with "first phone is approved automatically" the next phone used becomes the new one. */
  async resetDevice(companyId: string, id: string, actor: AuthUser, ip: string) {
    await this.get(companyId, id);
    const rows = await this.db.query(
      `UPDATE devices SET status = 'revoked' WHERE company_id = $1 AND employee_id = $2 AND status IN ('active', 'pending') RETURNING id, device_name`,
      [companyId, id],
    );
    await this.audit.log({ companyId, userId: actor.id, action: 'reset_device', module: 'employees', recordId: id, oldValue: { devices: rows }, ip });
    return { revoked: rows.length };
  }

  async setPhoto(companyId: string, id: string, url: string, actor: AuthUser, ip: string) {
    const before = await this.db.maybeOne('SELECT profile_photo FROM employees WHERE company_id = $1 AND id = $2', [companyId, id]);
    if (!before) throw notFound('Employee');
    await this.db.query('UPDATE employees SET profile_photo = $3, updated_at = now() WHERE company_id = $1 AND id = $2', [companyId, id, url]);
    await this.audit.log({ companyId, userId: actor.id, action: 'update_photo', module: 'employees', recordId: id, oldValue: before, newValue: { profile_photo: url }, ip });
    return before.profile_photo as string | null;
  }

  /** Adds or updates employees from rows (the admin app parses the CSV). Missing departments/positions are created. */
  async import(companyId: string, dto: ImportEmployeesDto, actor: AuthUser, ip: string) {
    if (!PASSWORD_RULE.test(dto.initialPassword)) throw badRequest(PASSWORD_RULE_TEXT, 'WEAK_PASSWORD');
    const errors: { row: number; message: string }[] = [];
    dto.rows.forEach((r, i) => {
      if (!EMPLOYEE_CODE.test(r.employeeCode?.trim() || '')) errors.push({ row: i + 1, message: `Invalid employee ID "${r.employeeCode}"` });
      if (!r.name?.trim()) errors.push({ row: i + 1, message: 'Name is required' });
    });
    const codes = dto.rows.map((r) => r.employeeCode.trim().toLowerCase());
    codes.forEach((c, i) => {
      if (codes.indexOf(c) !== i) errors.push({ row: i + 1, message: `Employee ID "${dto.rows[i].employeeCode}" appears twice` });
    });
    if (errors.length) throw badRequest('Fix the file and try again.', 'IMPORT_INVALID', { errors: errors.slice(0, 50) });

    const known = new Set((await this.db.query('SELECT lower(employee_code) AS c FROM employees WHERE company_id = $1', [companyId])).map((r) => r.c));
    await this.ctx.assertStaffLimit(companyId, codes.filter((c) => !known.has(c)).length);
    const hash = await hashPassword(dto.initialPassword);
    return this.db.tx(async (tx) => {
      const lookup = async (table: 'departments' | 'positions', name?: string) => {
        if (!name?.trim()) return null;
        const found = await tx.maybeOne(`SELECT id FROM ${table} WHERE company_id = $1 AND lower(name) = lower($2)`, [companyId, name.trim()]);
        if (found) return found.id;
        return (await tx.one(`INSERT INTO ${table} (company_id, name) VALUES ($1, $2) RETURNING id`, [companyId, name.trim()])).id;
      };
      const branchCache = new Map<string, string | null>();
      const branchId = async (v?: string) => {
        if (!v?.trim()) return null;
        const key = v.trim().toLowerCase();
        if (!branchCache.has(key)) {
          const b = await tx.maybeOne(`SELECT id FROM branches WHERE company_id = $1 AND (lower(code) = $2 OR lower(name) = $2)`, [companyId, key]);
          branchCache.set(key, b?.id ?? null);
        }
        const id = branchCache.get(key);
        if (!id) throw badRequest(`Branch "${v}" not found. Create it first or use its code.`, 'IMPORT_INVALID');
        return id;
      };
      let created = 0;
      let updated = 0;
      for (const r of dto.rows) {
        const vals = {
          code: r.employeeCode.trim(), name: r.name.trim(), phone: r.phone?.trim() || null, email: r.email?.trim().toLowerCase() || null,
          dep: await lookup('departments', r.department), pos: await lookup('positions', r.position), branch: await branchId(r.branch),
        };
        const existing = await tx.maybeOne('SELECT id FROM employees WHERE company_id = $1 AND lower(employee_code) = lower($2)', [companyId, vals.code]);
        if (existing) {
          await tx.query(
            `UPDATE employees SET name = $2, phone = coalesce($3, phone), email = coalesce($4, email), department_id = coalesce($5, department_id),
                    position_id = coalesce($6, position_id), branch_id = coalesce($7, branch_id), updated_at = now() WHERE id = $1`,
            [existing.id, vals.name, vals.phone, vals.email, vals.dep, vals.pos, vals.branch],
          );
          if (vals.phone) {
            await tx.query(`UPDATE users SET phone = $2, phone_norm = $3 WHERE employee_id = $1 AND role = 'employee'`, [existing.id, vals.phone, normalizePhone(vals.phone)]);
          }
          updated++;
        } else {
          const e = await tx.one(
            `INSERT INTO employees (company_id, employee_code, name, phone, email, department_id, position_id, branch_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [companyId, vals.code, vals.name, vals.phone, vals.email, vals.dep, vals.pos, vals.branch],
          );
          await tx.query(
            `INSERT INTO users (company_id, employee_id, username, name, role, password_hash, must_change_password, phone, phone_norm)
             VALUES ($1, $2, $3, $4, 'employee', $5, true, $6, $7)`,
            [companyId, e.id, vals.code, vals.name, hash, vals.phone, normalizePhone(vals.phone)],
          );
          created++;
        }
      }
      await this.audit.log({ companyId, userId: actor.id, action: 'import', module: 'employees', newValue: { created, updated }, ip }, tx);
      return { created, updated };
    });
  }
}
