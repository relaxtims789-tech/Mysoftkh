import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../../database/db.service';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { billingStatus, BillingStatus, branchLimit, EXPIRED_ADMIN_MESSAGE, Tier } from '../../domain/billing';
import { PunchRules, Schedule } from '../../domain/punch-rules';
import { localParts } from '../../domain/time';

export interface CompanyRules extends PunchRules {
  requireGps: boolean;
  requireDeviceBinding: boolean;
  deviceApprovalMode: 'auto_first' | 'admin';
  geofenceRadius: number;
  maxGpsAccuracy: number;
  minScanIntervalSeconds: number;
  restrictToHomeBranch: boolean;
  allowEmployeeCorrections: boolean;
  /** Check-in / check-out buttons without scanning the QR. */
  allowButtonCheckin: boolean;
}

export interface CompanyContext {
  id: string;
  name: string;
  code: string;
  logo: string | null;
  timezone: string;
  status: string;
  rules: CompanyRules;
}

export function rowToRules(r: any): CompanyRules {
  return {
    allowLunchScan: r.allow_lunch_scan,
    requireGps: r.require_gps,
    requireDeviceBinding: r.require_device_binding,
    deviceApprovalMode: r.device_approval_mode,
    allowOvertime: r.allow_overtime,
    overtimeMinMinutes: r.overtime_min_minutes,
    geofenceRadius: r.geofence_radius,
    maxGpsAccuracy: r.max_gps_accuracy,
    minScanIntervalSeconds: r.min_scan_interval_seconds,
    restrictToHomeBranch: r.restrict_to_home_branch,
    allowEmployeeCorrections: r.allow_employee_corrections,
    allowButtonCheckin: !!r.allow_button_checkin,
  };
}

export function rowToSchedule(r: any): Schedule {
  return {
    startTime: r.start_time,
    endTime: r.end_time,
    lunchStart: r.lunch_start,
    lunchEnd: r.lunch_end,
    lateAfterMinutes: r.late_after_minutes,
    graceMinutes: r.grace_minutes,
    workDays: (r.work_days || []).map(Number),
  };
}

/** Company settings, schedules, holidays and leave: what the attendance engine needs to judge a day. */
@Injectable()
export class CompanyContextService {
  constructor(private readonly db: Db) {}

  async get(companyId: string, tx: Queryable = this.db): Promise<CompanyContext> {
    const row = await tx.maybeOne(
      `SELECT c.*, r.* , c.id AS company_id_, c.status AS company_status
         FROM companies c LEFT JOIN attendance_rules r ON r.company_id = c.id
        WHERE c.id = $1`,
      [companyId],
    );
    if (!row) throw notFound('Company');
    return {
      id: row.company_id_,
      name: row.name,
      code: row.code,
      logo: row.logo,
      timezone: row.timezone,
      status: row.company_status,
      rules: rowToRules(row.allow_lunch_scan === null || row.allow_lunch_scan === undefined ? DEFAULT_RULES_ROW : row),
    };
  }

  /** Today's date and minutes in the company timezone. */
  now(tz: string, at = new Date()) {
    return localParts(at, tz);
  }

  /** Employee's schedule (own, or the company default). */
  async scheduleFor(companyId: string, scheduleId: string | null, tx: Queryable = this.db): Promise<Schedule | null> {
    const row = await tx.maybeOne(
      `SELECT * FROM work_schedules
        WHERE company_id = $1 AND status = 'active' AND (id = $2 OR ($2::uuid IS NULL AND is_default))
        ORDER BY (id = $2) DESC NULLS LAST LIMIT 1`,
      [companyId, scheduleId],
    );
    if (row) return rowToSchedule(row);
    if (scheduleId) return this.scheduleFor(companyId, null, tx);
    return null;
  }

  /** All active schedules keyed by id, plus the default under key ''. */
  async schedules(companyId: string): Promise<Map<string, Schedule>> {
    const rows = await this.db.query(`SELECT * FROM work_schedules WHERE company_id = $1 AND status = 'active'`, [companyId]);
    const map = new Map<string, Schedule>();
    for (const r of rows) {
      map.set(r.id, rowToSchedule(r));
      if (r.is_default) map.set('', rowToSchedule(r));
    }
    return map;
  }

  async holidays(companyId: string, from: string, to: string, tx: Queryable = this.db): Promise<Map<string, string>> {
    const rows = await tx.query(`SELECT date, name FROM holidays WHERE company_id = $1 AND date BETWEEN $2 AND $3`, [companyId, from, to]);
    return new Map(rows.map((r) => [r.date, r.name]));
  }

  async holidayName(companyId: string, date: string, tx: Queryable = this.db): Promise<string | null> {
    return (await this.holidays(companyId, date, date, tx)).get(date) ?? null;
  }

  /**
   * Payroll for a month is locked once approved: attendance, overtime and pay items of that month cannot change until a
   * company admin unlocks it. Throws when any of the dates falls in a locked month.
   */
  async assertPayrollOpen(companyId: string, dates: string[], tx: Queryable = this.db): Promise<void> {
    const months = [...new Set(dates.filter(Boolean).map((d) => `${d.slice(0, 7)}-01`))];
    if (!months.length) return;
    const r = await tx.maybeOne(
      `SELECT to_char(month, 'YYYY-MM') AS month, status FROM payroll_runs
        WHERE company_id = $1 AND month = ANY($2::date[]) AND status <> 'draft' ORDER BY month LIMIT 1`,
      [companyId, months],
    );
    if (r) throw badRequest(`Payroll for ${r.month} is ${r.status} and locked. A company admin must unlock it first.`, 'PAYROLL_LOCKED');
  }

  /** Subscription state of a company (trial / active / grace / expired) and its plan. */
  async billing(companyId: string, tx: Queryable = this.db): Promise<{ status: BillingStatus; tier: Tier | null; branchLimit: number | null; branchLimitCustom: boolean }> {
    const r = await tx.maybeOne(
      `SELECT c.billing_exempt, c.trial_ends_at, c.paid_until, c.timezone, c.branch_limit_custom, c.branch_limit,
              t.id AS tier_id, t.min_staff, t.max_staff, t.monthly_price, t.max_branches,
              (SELECT grace_days FROM platform_settings WHERE id = 1) AS grace_days
         FROM companies c LEFT JOIN price_tiers t ON t.id = c.tier_id WHERE c.id = $1`,
      [companyId],
    );
    if (!r) throw notFound('Company');
    const today = localParts(new Date(), r.timezone || 'Asia/Phnom_Penh').date;
    return {
      status: billingStatus({ exempt: r.billing_exempt, trialEndsAt: r.trial_ends_at, paidUntil: r.paid_until }, today, r.grace_days ?? 7),
      tier: r.tier_id ? { id: r.tier_id, minStaff: r.min_staff, maxStaff: r.max_staff, monthlyPrice: Number(r.monthly_price), maxBranches: r.max_branches } : null,
      branchLimit: branchLimit({ custom: r.branch_limit_custom, customLimit: r.branch_limit, exempt: r.billing_exempt, planMax: r.max_branches, hasPlan: !!r.tier_id }),
      branchLimitCustom: r.branch_limit_custom,
    };
  }

  /** Read-only once the trial / paid period and the grace days are over. */
  async assertWritable(companyId: string, tx: Queryable = this.db): Promise<void> {
    const { status } = await this.billing(companyId, tx);
    if (status.readOnly) throw forbidden(EXPIRED_ADMIN_MESSAGE, 'SUBSCRIPTION_EXPIRED');
  }

  /** Active branches and how many the plan (or the super admin) allows; limit null = unlimited. */
  async branchAllowance(companyId: string, tx: Queryable = this.db) {
    const b = await this.billing(companyId, tx);
    const used = Number((await tx.one(`SELECT count(*) AS n FROM branches WHERE company_id = $1 AND status = 'active'`, [companyId])).n);
    return { used, limit: b.branchLimit, source: b.branchLimitCustom ? 'custom' : b.tier && b.status.state !== 'exempt' ? 'plan' : 'none' };
  }

  async assertBranchLimit(companyId: string, adding: number, tx: Queryable = this.db): Promise<void> {
    if (adding <= 0) return;
    const a = await this.branchAllowance(companyId, tx);
    if (a.limit !== null && a.used + adding > a.limit) {
      throw badRequest(`Your plan allows ${a.limit} active branch${a.limit === 1 ? '' : 'es'} (you have ${a.used}). Choose a bigger plan in Billing & plan, or ask us for more.`, 'BRANCH_LIMIT', { limit: a.limit, used: a.used });
    }
  }

  /** Active staff may not go above the plan's staff limit (no limit for exempt companies or without a plan). */
  async assertStaffLimit(companyId: string, adding: number, tx: Queryable = this.db): Promise<void> {
    if (adding <= 0) return;
    const { status, tier } = await this.billing(companyId, tx);
    if (status.state === 'exempt' || !tier) return;
    const n = Number((await tx.one(`SELECT count(*) AS n FROM employees WHERE company_id = $1 AND status = 'active'`, [companyId])).n);
    if (n + adding > tier.maxStaff) {
      throw badRequest(`Your plan covers up to ${tier.maxStaff} active staff (you have ${n}). Choose a bigger plan in Billing.`, 'STAFF_LIMIT', { limit: tier.maxStaff, active: n });
    }
  }

  /** Approved leave by employee id -> list of {start, end, type}. */
  async approvedLeave(companyId: string, from: string, to: string, employeeId?: string) {
    const rows = await this.db.query(
      `SELECT employee_id, start_date, end_date, leave_type FROM leave_requests
        WHERE company_id = $1 AND status = 'approved' AND start_date <= $3 AND end_date >= $2
          AND ($4::uuid IS NULL OR employee_id = $4)`,
      [companyId, from, to, employeeId ?? null],
    );
    const map = new Map<string, { start: string; end: string; type: string }[]>();
    for (const r of rows) {
      const list = map.get(r.employee_id) ?? [];
      list.push({ start: r.start_date, end: r.end_date, type: r.leave_type });
      map.set(r.employee_id, list);
    }
    return map;
  }
}

const DEFAULT_RULES_ROW = {
  allow_lunch_scan: false, require_gps: true, require_device_binding: true, device_approval_mode: 'auto_first',
  allow_overtime: true, overtime_min_minutes: 30, geofence_radius: 100, max_gps_accuracy: 150,
  min_scan_interval_seconds: 30, restrict_to_home_branch: false, allow_employee_corrections: true, allow_button_checkin: false,
};
