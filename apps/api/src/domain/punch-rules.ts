import { timeToMinutes } from './time';

/** Pure attendance rules: what a scan means and how it is judged. No I/O, fully unit-tested. */

export const ATTENDANCE_TYPES = ['check_in', 'lunch_out', 'lunch_in', 'check_out'] as const;
export type AttendanceType = (typeof ATTENDANCE_TYPES)[number];

export type PunchStatus = 'on_time' | 'late' | 'early_leave' | 'overtime' | 'off_day';

export interface Schedule {
  startTime: string; // HH:MM[:SS]
  endTime: string;
  lunchStart: string | null;
  lunchEnd: string | null;
  /** Check-in after start + this is late (e.g. 15 -> late after 08:15). */
  lateAfterMinutes: number;
  /** Tolerance for early check-out and late return from lunch. */
  graceMinutes: number;
  /** ISO weekdays 1..7 */
  workDays: number[];
}

export interface PunchRules {
  allowLunchScan: boolean;
  allowOvertime: boolean;
  /** Overtime only counts when check-out is at least this many minutes after the end time. */
  overtimeMinMinutes: number;
}

export interface PunchEvaluation {
  status: PunchStatus;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
}

export const TYPE_LABELS: Record<AttendanceType, string> = {
  check_in: 'Check-in',
  lunch_out: 'Lunch-out',
  lunch_in: 'Lunch-in',
  check_out: 'Check-out',
};

export function hasLunch(s: Schedule): boolean {
  return !!(s.lunchStart && s.lunchEnd);
}

/**
 * Judges one scan against the schedule. Times are compared in whole minutes, so with start 08:00 and
 * late-after 15: 07:55 and 08:03 are on time, 08:15:59 is on time, 08:16 is late (16 minutes).
 */
export function evaluatePunch(
  type: AttendanceType,
  localMinutes: number,
  schedule: Schedule | null,
  rules: PunchRules,
  isWorkingDay: boolean,
): PunchEvaluation {
  const none: PunchEvaluation = { status: 'on_time', lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0 };
  if (!schedule) return none;
  if (!isWorkingDay) return { ...none, status: 'off_day' };
  const m = Math.floor(localMinutes);
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);

  switch (type) {
    case 'check_in':
      return m > start + schedule.lateAfterMinutes ? { ...none, status: 'late', lateMinutes: m - start } : none;
    case 'lunch_in': {
      if (!hasLunch(schedule)) return none;
      const lunchEnd = timeToMinutes(schedule.lunchEnd!);
      return m > lunchEnd + schedule.graceMinutes ? { ...none, status: 'late', lateMinutes: m - lunchEnd } : none;
    }
    case 'check_out':
      if (m < end - schedule.graceMinutes) return { ...none, status: 'early_leave', earlyMinutes: end - m };
      if (rules.allowOvertime && m - end >= Math.max(1, rules.overtimeMinMinutes)) {
        return { ...none, status: 'overtime', overtimeMinutes: m - end };
      }
      return none;
    default:
      return none;
  }
}

export interface TodayPunch {
  type: AttendanceType;
  minutes: number;
  time: Date;
}

/**
 * The next scan type when the employee just scans the QR (no explicit choice):
 * nothing yet -> check-in; around lunch -> lunch-out / lunch-in (when lunch scans are on); otherwise check-out.
 */
export function resolveScanType(today: TodayPunch[], localMinutes: number, schedule: Schedule | null, rules: PunchRules): AttendanceType {
  const has = (t: AttendanceType) => today.some((p) => p.type === t);
  if (!has('check_in') && !has('check_out')) return 'check_in';
  if (rules.allowLunchScan && schedule && hasLunch(schedule) && !has('check_out')) {
    const lunchStart = timeToMinutes(schedule.lunchStart!);
    const lunchEnd = timeToMinutes(schedule.lunchEnd!);
    const end = timeToMinutes(schedule.endTime);
    if (!has('lunch_out') && localMinutes >= lunchStart - 30 && localMinutes < lunchEnd) return 'lunch_out';
    if (has('lunch_out') && !has('lunch_in') && localMinutes < end - schedule.graceMinutes) return 'lunch_in';
  }
  return 'check_out';
}

export interface RuleViolation {
  code: string;
  message: string;
}

/** Checks an explicit (or resolved) scan type against what was already recorded today. */
export function validateScanType(type: AttendanceType, today: TodayPunch[], rules: PunchRules, fmt: (d: Date) => string): RuleViolation | null {
  const first = (t: AttendanceType) => today.find((p) => p.type === t);
  const checkIn = first('check_in');
  const checkOut = first('check_out');
  switch (type) {
    case 'check_in':
      if (checkIn) return { code: 'ALREADY_CHECKED_IN', message: `You already checked in today at ${fmt(checkIn.time)}.` };
      return null;
    case 'lunch_out':
    case 'lunch_in': {
      if (!rules.allowLunchScan) return { code: 'LUNCH_SCAN_DISABLED', message: 'Lunch scans are not used by your company.' };
      if (!checkIn) return { code: 'NOT_CHECKED_IN', message: 'Please check in first.' };
      if (checkOut) return { code: 'ALREADY_CHECKED_OUT', message: `You already checked out today at ${fmt(checkOut.time)}.` };
      const existing = first(type);
      if (existing) return { code: 'ALREADY_RECORDED', message: `${TYPE_LABELS[type]} was already recorded at ${fmt(existing.time)}.` };
      if (type === 'lunch_in' && !first('lunch_out')) return { code: 'LUNCH_NOT_STARTED', message: 'Lunch-out was not recorded.' };
      return null;
    }
    case 'check_out':
      // A later check-out replaces the earlier one in the day summary (last out counts), so it is allowed.
      return null;
  }
}

/** True when this check-out is before the end of the working day (the app asks the employee to confirm). */
export function isEarlyCheckout(localMinutes: number, schedule: Schedule | null, isWorkingDay: boolean): boolean {
  if (!schedule || !isWorkingDay) return false;
  return Math.floor(localMinutes) < timeToMinutes(schedule.endTime) - schedule.graceMinutes;
}
