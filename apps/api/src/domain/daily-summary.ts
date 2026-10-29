import { AttendanceType, PunchRules, Schedule, hasLunch } from './punch-rules';
import { timeToMinutes } from './time';

/** Turns one employee's scans for one date into the day's result (status, late, early, overtime, worked). */

export type DayStatus = 'present' | 'late' | 'absent' | 'leave' | 'holiday' | 'day_off' | 'not_yet' | 'upcoming';
export type DayFlag = 'early_leave' | 'overtime' | 'missing_check_in' | 'missing_check_out' | 'late_from_lunch' | 'worked_on_leave';

export interface DayPunch {
  id: string;
  type: AttendanceType;
  time: Date;
  /** Minutes since local midnight (company timezone). */
  minutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  status: string;
  branchId?: string | null;
  distance?: number | null;
}

export interface DayContext {
  date: string;
  /** 'past' | 'today' | 'future' relative to the company's current local date. */
  when: 'past' | 'today' | 'future';
  /** Current local minutes when when === 'today'. */
  nowMinutes?: number;
  schedule: Schedule | null;
  weekday: number;
  holiday: string | null;
  leave: { type: string } | null;
  rules: PunchRules;
}

export interface DaySummary {
  date: string;
  status: DayStatus;
  isWorkingDay: boolean;
  checkIn: Date | null;
  lunchOut: Date | null;
  lunchIn: Date | null;
  checkOut: Date | null;
  checkInBranchId: string | null;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  flags: DayFlag[];
  holiday: string | null;
  leaveType: string | null;
}

export function isWorkingDay(ctx: Pick<DayContext, 'schedule' | 'weekday' | 'holiday'>): boolean {
  return !!ctx.schedule && !ctx.holiday && ctx.schedule.workDays.includes(ctx.weekday);
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

export function summarizeDay(ctx: DayContext, punches: DayPunch[]): DaySummary {
  const sorted = [...punches].sort((a, b) => a.time.getTime() - b.time.getTime());
  const firstOf = (t: AttendanceType) => sorted.find((p) => p.type === t) ?? null;
  const lastOf = (t: AttendanceType) => [...sorted].reverse().find((p) => p.type === t) ?? null;

  const working = isWorkingDay(ctx);
  const cin = firstOf('check_in');
  const cout = lastOf('check_out');
  const lout = firstOf('lunch_out');
  const lin = lout ? sorted.find((p) => p.type === 'lunch_in' && p.time >= lout.time) ?? null : null;
  const flags: DayFlag[] = [];
  const s = ctx.schedule;

  let worked = 0;
  if (cin && cout && cout.time > cin.time) {
    worked = (cout.time.getTime() - cin.time.getTime()) / 60000;
    if (lout && lin && lin.time > lout.time) {
      worked -= (lin.time.getTime() - lout.time.getTime()) / 60000;
    } else if (s && hasLunch(s)) {
      worked -= overlap(cin.minutes, cout.minutes, timeToMinutes(s.lunchStart!), timeToMinutes(s.lunchEnd!));
    }
    worked = Math.max(0, Math.floor(worked));
  }

  const lateMinutes = working && cin ? cin.lateMinutes : 0;
  const earlyMinutes = working && cout ? cout.earlyMinutes : 0;
  let overtimeMinutes = 0;
  if (working) overtimeMinutes = cout ? cout.overtimeMinutes : 0;
  else if (ctx.rules.allowOvertime) overtimeMinutes = worked;

  let status: DayStatus;
  if (sorted.length) {
    status = cin && lateMinutes > 0 ? 'late' : 'present';
    if (!cin) flags.push('missing_check_in');
    if (ctx.leave) flags.push('worked_on_leave');
  } else if (ctx.leave && working) status = 'leave';
  else if (ctx.holiday) status = 'holiday';
  else if (!working) status = 'day_off';
  else if (ctx.when === 'future') status = 'upcoming';
  else if (ctx.when === 'today' && s && (ctx.nowMinutes ?? 0) <= timeToMinutes(s.startTime) + s.lateAfterMinutes) status = 'not_yet';
  else status = 'absent';

  if (cin && !cout && s) {
    const dayOver = ctx.when === 'past' || (ctx.when === 'today' && (ctx.nowMinutes ?? 0) >= timeToMinutes(s.endTime) + 120);
    if (dayOver) flags.push('missing_check_out');
  }
  if (earlyMinutes > 0) flags.push('early_leave');
  if (overtimeMinutes > 0) flags.push('overtime');
  if (lin && lin.lateMinutes > 0) flags.push('late_from_lunch');

  return {
    date: ctx.date,
    status,
    isWorkingDay: working,
    checkIn: cin?.time ?? null,
    lunchOut: lout?.time ?? null,
    lunchIn: lin?.time ?? null,
    checkOut: cout?.time ?? null,
    checkInBranchId: cin?.branchId ?? null,
    lateMinutes,
    earlyMinutes,
    overtimeMinutes,
    workedMinutes: worked,
    flags,
    holiday: ctx.holiday,
    leaveType: working ? ctx.leave?.type ?? null : null,
  };
}
