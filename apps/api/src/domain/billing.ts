/**
 * Subscription rules (pure, unit-tested).
 *
 * A company is covered until the later of its trial end and its paid-until date (both inclusive). After that it has
 * `graceDays` of normal use, then it becomes read-only: people can sign in, view, export and pay, but nothing else.
 * Exempt companies (created before billing existed, or marked free by the super admin) are never limited.
 */

export const EXPIRED_ADMIN_MESSAGE = 'Your subscription has ended. Renew it in Billing to continue (you can still view and export your data).';
export const EXPIRED_STAFF_MESSAGE = "Your company's subscription has ended. Ask your administrator to renew it.";

export type BillingState = 'exempt' | 'trial' | 'active' | 'grace' | 'expired';

export interface BillingInput {
  exempt: boolean;
  trialEndsAt: string | null;
  paidUntil: string | null;
}

export interface BillingStatus {
  state: BillingState;
  /** Last covered day (trial or paid), or null when exempt / never covered. */
  coveredUntil: string | null;
  /** Last day of the grace period. */
  graceUntil: string | null;
  /** Days left until coveredUntil (negative once it has passed). */
  daysLeft: number | null;
  readOnly: boolean;
}

export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Same day n months later, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

const maxDate = (...d: (string | null)[]) => d.filter((x): x is string => !!x).sort().pop() ?? null;

export function billingStatus(b: BillingInput, today: string, graceDays: number): BillingStatus {
  if (b.exempt) return { state: 'exempt', coveredUntil: null, graceUntil: null, daysLeft: null, readOnly: false };
  const covered = maxDate(b.trialEndsAt, b.paidUntil);
  if (!covered) return { state: 'expired', coveredUntil: null, graceUntil: null, daysLeft: null, readOnly: true };
  const graceUntil = addDaysIso(covered, Math.max(0, graceDays));
  const daysLeft = daysBetweenIso(today, covered);
  let state: BillingState;
  if (today <= covered) state = b.paidUntil && b.paidUntil >= today ? 'active' : 'trial';
  else if (today <= graceUntil) state = 'grace';
  else state = 'expired';
  return { state, coveredUntil: covered, graceUntil, daysLeft, readOnly: state === 'expired' };
}

export interface Tier {
  id: string;
  minStaff: number;
  maxStaff: number;
  monthlyPrice: number;
  /** Active branches allowed; null = unlimited. */
  maxBranches?: number | null;
}

/** The smallest tier that fits `staff` (the largest tier when none does). */
export function tierFor(tiers: Tier[], staff: number): Tier | null {
  const sorted = [...tiers].sort((a, b) => a.maxStaff - b.maxStaff);
  return sorted.find((t) => staff <= t.maxStaff) ?? sorted[sorted.length - 1] ?? null;
}

export type Cycle = 'monthly' | 'yearly';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Yearly = 12 months minus `yearlyFreeMonths` free months. */
export function priceFor(tier: Pick<Tier, 'monthlyPrice'>, cycle: Cycle, yearlyFreeMonths: number) {
  const months = cycle === 'yearly' ? 12 : 1;
  const paidMonths = cycle === 'yearly' ? Math.max(0, 12 - yearlyFreeMonths) : 1;
  return { months, amount: round2(tier.monthlyPrice * paidMonths), fullAmount: round2(tier.monthlyPrice * months) };
}

/** A renewal starts the day after the current cover ends (paying early never loses days), or today if it has lapsed. */
export function renewalPeriod(b: BillingInput, today: string, months: number): { start: string; end: string } {
  const covered = maxDate(b.trialEndsAt, b.paidUntil);
  const start = covered && covered >= today ? addDaysIso(covered, 1) : today;
  return { start, end: addDaysIso(addMonthsIso(start, months), -1) };
}

/**
 * Moving to a bigger tier during a paid period: the price difference for the rest of the period, in whole months
 * (a started month counts as a full month).
 */
export function upgradePrice(from: Pick<Tier, 'monthlyPrice'>, to: Pick<Tier, 'monthlyPrice'>, today: string, paidUntil: string): { months: number; amount: number } {
  let months = 1;
  while (months < 120 && addDaysIso(addMonthsIso(today, months), -1) < paidUntil) months++;
  return { months, amount: round2(Math.max(0, to.monthlyPrice - from.monthlyPrice) * months) };
}

/**
 * Branches a company may have active: the super admin's own number for this company when set (null = unlimited),
 * otherwise the plan's (null = unlimited). Free-plan companies and companies without a plan are not limited.
 */
export function branchLimit(c: { custom: boolean; customLimit: number | null; exempt: boolean; planMax: number | null | undefined; hasPlan: boolean }): number | null {
  if (c.custom) return c.customLimit;
  if (c.exempt || !c.hasPlan) return null;
  return c.planMax ?? null;
}
