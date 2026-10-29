import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { config } from '../config';
import { Db } from '../database/db.service';
import { forbidden, unauthorized } from './errors';
import { billingStatus, EXPIRED_ADMIN_MESSAGE, EXPIRED_STAFF_MESSAGE } from '../domain/billing';
import { localParts } from '../domain/time';

/** What a read-only (expired) company may still change: sign-in / password and paying. */
const ALLOWED_WHEN_EXPIRED = /^\/api\/(auth|billing)(\/|\?|$)/;

export type Role = 'super_admin' | 'company_admin' | 'hr' | 'manager' | 'employee';
export const ROLES: Role[] = ['super_admin', 'company_admin', 'hr', 'manager', 'employee'];
/** Roles that manage a whole company. */
export const ADMIN_ROLES: Role[] = ['super_admin', 'company_admin', 'hr'];
/** Roles that see other people's attendance (managers only for their departments). */
export const STAFF_ROLES: Role[] = ['super_admin', 'company_admin', 'hr', 'manager'];

/** The signed-in user, re-read from the database on every request so disabling an account takes effect at once. */
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  /** Company the request acts on. A super admin picks one with the X-Company-Id header. */
  companyId: string | null;
  employeeId: string | null;
  /** Departments a manager may see; null = no department restriction. */
  departmentIds: string[] | null;
  mustChangePassword: boolean;
}

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  cid: string | null;
}

export function signAccessToken(p: AccessTokenPayload): string {
  return jwt.sign(p, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.accessTokenTtlSeconds, issuer: 'qr-attendance', audience: 'api' });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'qr-attendance', audience: 'api' }) as AccessTokenPayload;
}

const IS_PUBLIC = 'isPublic';
const ROLES_KEY = 'roles';
const ALLOW_PW_CHANGE = 'allowPendingPasswordChange';

/** Route needs no sign-in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route is limited to these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Route stays usable while the user still has to change a temporary password. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PW_CHANGE, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

export function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Global guard: JWT -> fresh user row -> account/company status -> role check. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw unauthorized();
    let payload: AccessTokenPayload;
    try {
      payload = verifyAccessToken(token);
    } catch (e) {
      throw unauthorized('Your session has expired. Please sign in again.', (e as Error).name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED');
    }
    if (!isUuid(payload.sub)) throw unauthorized();

    const row = await this.db.maybeOne(
      `SELECT u.id, u.role, u.name, u.company_id, u.employee_id, u.status, u.must_change_password,
              c.status AS company_status, e.status AS employee_status,
              c.billing_exempt, c.trial_ends_at, c.paid_until, c.timezone AS company_tz,
              (SELECT grace_days FROM platform_settings WHERE id = 1) AS grace_days
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.id = $1`,
      [payload.sub],
    );
    if (!row || row.status !== 'active') throw unauthorized('Your account is disabled.', 'ACCOUNT_DISABLED');
    if (row.company_id && row.company_status !== 'active') throw unauthorized('Your company account is suspended.', 'COMPANY_SUSPENDED');
    if (row.employee_id && row.employee_status !== 'active') throw unauthorized('Your employee record is inactive.', 'EMPLOYEE_INACTIVE');

    if (row.company_id && row.role !== 'super_admin' && req.method !== 'GET' && !ALLOWED_WHEN_EXPIRED.test(req.originalUrl)) {
      const today = localParts(new Date(), row.company_tz || 'Asia/Phnom_Penh').date;
      const b = billingStatus({ exempt: row.billing_exempt, trialEndsAt: row.trial_ends_at, paidUntil: row.paid_until }, today, row.grace_days ?? 7);
      if (b.readOnly) throw forbidden(row.role === 'company_admin' ? EXPIRED_ADMIN_MESSAGE : EXPIRED_STAFF_MESSAGE, 'SUBSCRIPTION_EXPIRED');
    }

    let companyId: string | null = row.company_id;
    if (row.role === 'super_admin') {
      const chosen = req.headers['x-company-id'];
      if (typeof chosen === 'string' && chosen) {
        const exists = isUuid(chosen) && (await this.db.maybeOne('SELECT 1 FROM companies WHERE id = $1', [chosen]));
        if (!exists) throw forbidden('Unknown company.', 'UNKNOWN_COMPANY');
        companyId = chosen;
      }
    }

    let departmentIds: string[] | null = null;
    if (row.role === 'manager') {
      const deps = await this.db.query<{ department_id: string }>('SELECT department_id FROM manager_departments WHERE user_id = $1', [row.id]);
      departmentIds = deps.map((d) => d.department_id);
    }

    req.user = {
      id: row.id,
      role: row.role,
      name: row.name,
      companyId,
      employeeId: row.employee_id,
      departmentIds,
      mustChangePassword: row.must_change_password,
    };

    if (row.must_change_password && !this.reflector.getAllAndOverride<boolean>(ALLOW_PW_CHANGE, targets)) {
      throw forbidden('Please change your temporary password first.', 'PASSWORD_CHANGE_REQUIRED');
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles && !roles.includes(row.role)) throw forbidden();
    return true;
  }
}

/** Company the request acts on; super admins must pick one first. */
export function requireCompany(user: AuthUser): string {
  if (!user.companyId) throw forbidden('Select a company first.', 'COMPANY_REQUIRED');
  return user.companyId;
}

/** Employee record of the signed-in user (employee self-service). */
export function requireEmployee(user: AuthUser): string {
  if (!user.employeeId) throw forbidden('This account is not linked to an employee.', 'NOT_AN_EMPLOYEE');
  return user.employeeId;
}
