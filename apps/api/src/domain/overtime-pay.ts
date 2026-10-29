/**
 * Overtime pay rules (pure, unit-tested).
 *
 * Each kind of day has its own rule:
 *   multiplier  OT hours x hourly rate x value          (e.g. 1.5 = time and a half)
 *   fixed_hour  OT hours x value                         (a fixed amount per OT hour)
 *   fixed_day   value per day worked, when at least minHours were worked that day   (days off / holidays only)
 * The hourly rate is the employee's own hourly rate, or monthly salary / company "hours per month".
 */

export type OtDayType = 'work_day' | 'day_off' | 'holiday';
export type OtMode = 'multiplier' | 'fixed_hour' | 'fixed_day';

export interface OtRule {
  mode: OtMode;
  value: number;
  /** fixed_day only: minimum hours worked for the day to count. */
  minHours: number;
}

export interface OtPolicy {
  requiresApproval: boolean;
  currency: string;
  /** Monthly salary / this = hourly rate (e.g. 26 days x 8 h = 208). */
  monthlyHours: number;
  workDay: OtRule;
  dayOff: OtRule;
  holiday: OtRule;
}

export const DEFAULT_OT_POLICY: OtPolicy = {
  requiresApproval: false,
  currency: 'USD',
  monthlyHours: 208,
  workDay: { mode: 'multiplier', value: 1.5, minHours: 0 },
  dayOff: { mode: 'multiplier', value: 2, minHours: 0 },
  holiday: { mode: 'multiplier', value: 2, minHours: 0 },
};

export function hourlyRate(pay: { monthlySalary: number | null; hourlyRate: number | null }, policy: Pick<OtPolicy, 'monthlyHours'>): number | null {
  if (pay.hourlyRate != null && pay.hourlyRate > 0) return pay.hourlyRate;
  if (pay.monthlySalary != null && pay.monthlySalary > 0 && policy.monthlyHours > 0) return pay.monthlySalary / policy.monthlyHours;
  return null;
}

export function ruleFor(policy: OtPolicy, dayType: OtDayType): OtRule {
  return dayType === 'work_day' ? policy.workDay : dayType === 'holiday' ? policy.holiday : policy.dayOff;
}

export interface OtDayPay {
  hours: number;
  /** Hours x multiplier (multiplier rules only); what payroll calls "weighted" or "equivalent" hours. */
  weightedHours: number | null;
  /** 1 when a fixed_day rule paid this day. */
  paidDays: number;
  /** Money; null when it needs an hourly rate that the employee does not have. */
  amount: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pay for one day's (approved) overtime minutes. A work day never uses fixed_day (treated as multiplier). */
export function otPayForDay(minutes: number, dayType: OtDayType, policy: OtPolicy, rate: number | null): OtDayPay {
  const hours = Math.max(0, minutes) / 60;
  const rule = ruleFor(policy, dayType);
  if (hours <= 0) return { hours: 0, weightedHours: rule.mode === 'multiplier' ? 0 : null, paidDays: 0, amount: 0 };
  if (rule.mode === 'fixed_hour') return { hours: round2(hours), weightedHours: null, paidDays: 0, amount: round2(hours * rule.value) };
  if (rule.mode === 'fixed_day' && dayType !== 'work_day') {
    const counts = hours >= rule.minHours;
    return { hours: round2(hours), weightedHours: null, paidDays: counts ? 1 : 0, amount: counts ? round2(rule.value) : 0 };
  }
  const weighted = hours * rule.value;
  return { hours: round2(hours), weightedHours: round2(weighted), paidDays: 0, amount: rate == null ? null : round2(weighted * rate) };
}

export interface OtTotals {
  workDayHours: number;
  dayOffHours: number;
  holidayHours: number;
  otDays: number;
  paidDays: number;
  weightedHours: number;
  amount: number | null;
  /** Set when some days could not be priced because the employee has no salary / hourly rate. */
  missingRate: boolean;
}

export function sumOt(days: { dayType: OtDayType; pay: OtDayPay }[]): OtTotals {
  const t: OtTotals = { workDayHours: 0, dayOffHours: 0, holidayHours: 0, otDays: 0, paidDays: 0, weightedHours: 0, amount: 0, missingRate: false };
  for (const { dayType, pay } of days) {
    if (pay.hours <= 0) continue;
    t.otDays++;
    if (dayType === 'work_day') t.workDayHours += pay.hours;
    else if (dayType === 'holiday') t.holidayHours += pay.hours;
    else t.dayOffHours += pay.hours;
    t.paidDays += pay.paidDays;
    t.weightedHours += pay.weightedHours ?? 0;
    if (pay.amount == null) t.missingRate = true;
    else t.amount = (t.amount ?? 0) + pay.amount;
  }
  return {
    ...t,
    workDayHours: round2(t.workDayHours), dayOffHours: round2(t.dayOffHours), holidayHours: round2(t.holidayHours),
    weightedHours: round2(t.weightedHours), amount: t.amount == null ? null : round2(t.amount),
  };
}
