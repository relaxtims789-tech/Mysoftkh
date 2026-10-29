import { Injectable } from '@nestjs/common';
import { billingStatus } from '../../domain/billing';
import { localParts } from '../../domain/time';
import { randomUUID } from 'crypto';
import { config } from '../../config';
import { Db } from '../../database/db.service';
import { AuthUser, isUuid, signAccessToken } from '../../common/auth';
import { badRequest, unauthorized } from '../../common/errors';
import { DUMMY_PASSWORD_HASH, hashPassword, randomToken, sha256, verifyPassword } from '../../common/crypto';
import { AuditService } from '../audit/audit.service';
import { looksLikePhone, normalizePhone } from '../../common/phone';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** A just-rotated refresh token may be presented again this long (two tabs refreshing together). */
const ROTATION_GRACE_SECONDS = 20;

export interface SessionMeta {
  ip: string;
  userAgent: string;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpires: Date;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  async login(companyCode: string | undefined, login: string, password: string, meta: SessionMeta): Promise<IssuedSession> {
    const name = login.trim().toLowerCase();
    // A phone number can be typed instead of an email / employee ID.
    const phone = looksLikePhone(login) ? normalizePhone(login) : null;
    // Exact email / username matches come first; a phone number may match more than one account (shared or
    // mistyped numbers), so up to 5 are tried and the one whose password matches signs in.
    const candidates: any[] = companyCode?.trim()
      ? await this.db.query(
          `SELECT u.*, c.status AS company_status FROM users u JOIN companies c ON c.id = u.company_id
            WHERE lower(c.code) = lower($1) AND (lower(u.username) = $2 OR lower(u.email) = $2 OR ($3::text IS NOT NULL AND u.phone_norm = $3))
            ORDER BY (lower(u.username) = $2 OR lower(u.email) = $2) DESC, u.created_at LIMIT 5`,
          [companyCode.trim(), name, phone],
        )
      : await this.db.query(
          `SELECT u.*, c.status AS company_status FROM users u LEFT JOIN companies c ON c.id = u.company_id
            WHERE lower(u.email) = $1 OR ((u.company_id IS NULL OR $3::boolean) AND u.role <> 'employee' AND lower(u.username) = $1)
               OR ($2::text IS NOT NULL AND u.phone_norm = $2 AND u.role <> 'employee')
            ORDER BY (lower(u.email) = $1 OR lower(u.username) = $1) DESC, u.created_at LIMIT 5`,
          // The public demo signs its company admin in with a plain name ("DemoCompany").
          [name, phone, config.demoMode],
        );

    const invalid = () => unauthorized(
      companyCode ? 'Incorrect company code, employee ID / phone number or password.' : 'Incorrect email / phone number or password.',
      'INVALID_CREDENTIALS',
    );
    if (!candidates.length) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH); // same timing as a real check
      throw invalid();
    }
    const usable = candidates.filter((u) => !(u.locked_until && new Date(u.locked_until) > new Date()));
    if (!usable.length) throw unauthorized(`Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`, 'ACCOUNT_LOCKED');
    let user: any = null;
    for (const u of usable) {
      if (await verifyPassword(password, u.password_hash)) {
        user = u;
        break;
      }
    }
    if (!user) {
      // The public demo's shared sign-ins must not be locked by visitors typing a wrong password.
      for (const u of config.demoMode ? [] : usable) {
        const failed = u.failed_logins + 1;
        await this.db.query(
          `UPDATE users SET failed_logins = $2::int, locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) END WHERE id = $1`,
          [u.id, failed >= MAX_FAILED_LOGINS ? 0 : failed, failed >= MAX_FAILED_LOGINS, LOCK_MINUTES],
        );
        if (failed >= MAX_FAILED_LOGINS) {
          await this.audit.log({ companyId: u.company_id, userId: u.id, action: 'locked', module: 'auth', recordId: u.id, ip: meta.ip });
        }
      }
      throw invalid();
    }
    if (user.status !== 'active') throw unauthorized('Your account is disabled. Contact your administrator.', 'ACCOUNT_DISABLED');
    if (user.company_id && user.company_status !== 'active') throw unauthorized('Your company account is suspended.', 'COMPANY_SUSPENDED');
    if (user.employee_id) {
      const emp = await this.db.maybeOne('SELECT status FROM employees WHERE id = $1', [user.employee_id]);
      if (emp?.status !== 'active') throw unauthorized('Your employee record is inactive. Contact HR.', 'EMPLOYEE_INACTIVE');
    }

    await this.db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
    await this.audit.log({ companyId: user.company_id, userId: user.id, action: 'login', module: 'auth', recordId: user.id, ip: meta.ip, newValue: { userAgent: meta.userAgent } });
    return this.issue(user, randomUUID(), meta);
  }

  /**
   * Signs in a user that proved who they are another way (Telegram Mini App launch data signed by Telegram for a linked
   * account). Same account checks as a password sign-in.
   */
  async loginAsUser(userId: string, how: string, meta: SessionMeta): Promise<IssuedSession> {
    const user = await this.db.maybeOne(
      `SELECT u.*, c.status AS company_status, e.status AS employee_status FROM users u
         LEFT JOIN companies c ON c.id = u.company_id LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = $1`,
      [userId],
    );
    if (!user || user.status !== 'active') throw unauthorized('Your account is disabled. Contact your administrator.', 'ACCOUNT_DISABLED');
    if (user.company_id && user.company_status !== 'active') throw unauthorized('Your company account is suspended.', 'COMPANY_SUSPENDED');
    if (user.employee_id && user.employee_status !== 'active') throw unauthorized('Your employee record is inactive. Contact HR.', 'EMPLOYEE_INACTIVE');
    await this.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await this.audit.log({ companyId: user.company_id, userId: user.id, action: `login_${how}`, module: 'auth', recordId: user.id, ip: meta.ip, newValue: { userAgent: meta.userAgent } });
    return this.issue(user, randomUUID(), meta);
  }

  /** Exchanges a refresh token for a new pair. A token used twice (after the grace window) revokes the whole family. */
  async refresh(rawToken: string | undefined, meta: SessionMeta): Promise<IssuedSession> {
    if (!rawToken) throw unauthorized('Please sign in.', 'NO_SESSION');
    const row = await this.db.maybeOne(
      `SELECT t.*, u.role, u.company_id, u.status AS user_status FROM refresh_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`,
      [sha256(rawToken)],
    );
    if (!row) throw unauthorized('Please sign in.', 'NO_SESSION');
    if (row.revoked_at) {
      const rotatedRecently = row.rotated_at && Date.now() - new Date(row.rotated_at).getTime() < ROTATION_GRACE_SECONDS * 1000;
      if (!rotatedRecently) {
        await this.db.query('UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1', [row.family_id]);
        await this.audit.log({ companyId: row.company_id, userId: row.user_id, action: 'refresh_token_reuse', module: 'auth', recordId: row.family_id, ip: meta.ip });
        throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_REVOKED');
      }
    }
    if (new Date(row.expires_at) < new Date()) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
    if (row.user_status !== 'active') throw unauthorized('Your account is disabled.', 'ACCOUNT_DISABLED');

    await this.db.query('UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()), rotated_at = coalesce(rotated_at, now()) WHERE id = $1', [row.id]);
    return this.issue({ id: row.user_id, role: row.role, company_id: row.company_id }, row.family_id, meta);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const row = await this.db.maybeOne('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [sha256(rawToken)]);
    if (row) await this.db.query('UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1', [row.family_id]);
  }

  /** Ends every session of a user (password reset by an admin, account disabled). */
  async revokeAll(userId: string, exceptFamily?: string): Promise<void> {
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR family_id <> $2)',
      [userId, exceptFamily ?? null],
    );
  }

  async changePassword(user: AuthUser, current: string, next: string, rawRefresh: string | undefined, ip: string): Promise<void> {
    const row = await this.db.one('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!(await verifyPassword(current, row.password_hash))) throw badRequest('Your current password is incorrect.', 'WRONG_PASSWORD');
    if (current === next) throw badRequest('Choose a password different from the current one.', 'SAME_PASSWORD');
    await this.db.query('UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1', [user.id, await hashPassword(next)]);
    const fam = rawRefresh ? await this.db.maybeOne('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [sha256(rawRefresh)]) : null;
    await this.revokeAll(user.id, fam?.family_id);
    await this.audit.log({ companyId: user.companyId, userId: user.id, action: 'change_password', module: 'auth', recordId: user.id, ip });
  }

  /** Profile for a user id (right after sign-in, before the guard has built an AuthUser). */
  async profileFor(userId: string, companyOverride?: string) {
    const u = await this.db.one('SELECT id, role, name, company_id, employee_id, must_change_password FROM users WHERE id = $1', [userId]);
    // A super admin keeps the company chosen in the app (X-Company-Id) across refreshes.
    if (u.role === 'super_admin' && companyOverride && isUuid(companyOverride)) {
      const c = await this.db.maybeOne('SELECT id FROM companies WHERE id = $1', [companyOverride]);
      if (c) u.company_id = c.id;
    }
    const deps = u.role === 'manager'
      ? (await this.db.query('SELECT department_id FROM manager_departments WHERE user_id = $1', [userId])).map((r) => r.department_id)
      : null;
    return this.me({ id: u.id, role: u.role, name: u.name, companyId: u.company_id, employeeId: u.employee_id, departmentIds: deps, mustChangePassword: u.must_change_password });
  }

  /** The profile the apps show after sign-in. */
  async me(user: AuthUser) {
    const row = await this.db.one(
      `SELECT u.id, u.name, u.role, u.email, u.username, u.company_id, u.employee_id, u.must_change_password,
              c.name AS company_name, c.code AS company_code, c.logo AS company_logo, c.timezone,
              c.billing_exempt, c.trial_ends_at, c.paid_until, (SELECT grace_days FROM platform_settings WHERE id = 1) AS grace_days,
              e.employee_code, e.name AS employee_name, e.phone, e.email AS employee_email, e.profile_photo,
              d.name AS department_name, p.name AS position_name, b.name AS branch_name, b.id AS branch_id
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         LEFT JOIN employees e ON e.id = u.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN positions p ON p.id = e.position_id
         LEFT JOIN branches b ON b.id = e.branch_id
        WHERE u.id = $1`,
      [user.id],
    );
    const withBilling = (c: any) => ({
      id: c.company_id ?? c.id, name: c.company_name ?? c.name, code: c.company_code ?? c.code, logo: c.company_logo ?? c.logo, timezone: c.timezone,
      billing: billingStatus({ exempt: c.billing_exempt, trialEndsAt: c.trial_ends_at, paidUntil: c.paid_until }, localParts(new Date(), c.timezone || 'Asia/Phnom_Penh').date, c.grace_days ?? 7),
    });
    let company = row.company_id ? withBilling(row) : null;
    if (user.role === 'super_admin' && user.companyId && !company) {
      const c = await this.db.maybeOne(
        'SELECT id, name, code, logo, timezone, billing_exempt, trial_ends_at, paid_until, (SELECT grace_days FROM platform_settings WHERE id = 1) AS grace_days FROM companies WHERE id = $1',
        [user.companyId],
      );
      company = c ? withBilling(c) : null;
    }
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      email: row.email,
      username: row.username,
      mustChangePassword: row.must_change_password,
      departmentIds: user.departmentIds,
      company,
      employee: row.employee_id
        ? {
            id: row.employee_id,
            code: row.employee_code,
            name: row.employee_name,
            phone: row.phone,
            email: row.employee_email,
            photo: row.profile_photo,
            department: row.department_name,
            position: row.position_name,
            branch: row.branch_name,
            branchId: row.branch_id,
          }
        : null,
    };
  }

  private async issue(user: { id: string; role: any; company_id: string | null }, familyId: string, meta: SessionMeta): Promise<IssuedSession> {
    const refreshToken = randomToken(48);
    const refreshExpires = new Date(Date.now() + config.refreshTokenDays * 86400000);
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip_address) VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, familyId, sha256(refreshToken), refreshExpires, meta.userAgent.slice(0, 300), meta.ip],
    );
    // Old tokens are useless after expiry; keep the table small.
    if (Math.random() < 0.02) await this.db.query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
    return {
      accessToken: signAccessToken({ sub: user.id, role: user.role, cid: user.company_id }),
      expiresIn: config.accessTokenTtlSeconds,
      refreshToken,
      refreshExpires,
      userId: user.id,
    };
  }
}
