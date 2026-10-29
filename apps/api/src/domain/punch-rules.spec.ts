import { evaluatePunch, isEarlyCheckout, PunchRules, resolveScanType, Schedule, TodayPunch, validateScanType } from './punch-rules';
import { timeToMinutes } from './time';

const schedule: Schedule = {
  startTime: '08:00', endTime: '17:00', lunchStart: '12:00', lunchEnd: '13:00',
  lateAfterMinutes: 15, graceMinutes: 5, workDays: [1, 2, 3, 4, 5],
};
const rules: PunchRules = { allowLunchScan: true, allowOvertime: true, overtimeMinMinutes: 30 };
const at = (t: string) => timeToMinutes(t);
const punch = (type: TodayPunch['type'], t: string): TodayPunch => ({ type, minutes: at(t), time: new Date(`2026-10-06T${t}:00+07:00`) });
const fmt = (d: Date) => d.toISOString();

describe('evaluatePunch: check-in (spec example: start 08:00, late after 08:15)', () => {
  it.each([
    ['07:55', 'on_time', 0],
    ['08:03', 'on_time', 0],
    ['08:15', 'on_time', 0],
    ['08:16', 'late', 16],
    ['09:30', 'late', 90],
  ])('%s -> %s', (time, status, late) => {
    const r = evaluatePunch('check_in', at(time), schedule, rules, true);
    expect(r.status).toBe(status);
    expect(r.lateMinutes).toBe(late);
  });

  it('08:15:59 is still on time (whole minutes)', () => {
    expect(evaluatePunch('check_in', at('08:15') + 59 / 60, schedule, rules, true).status).toBe('on_time');
  });

  it('a non-working day is an off-day scan', () => {
    expect(evaluatePunch('check_in', at('09:00'), schedule, rules, false).status).toBe('off_day');
  });

  it('no schedule: always on time', () => {
    expect(evaluatePunch('check_in', at('11:00'), null, rules, true)).toEqual({ status: 'on_time', lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0 });
  });
});

describe('evaluatePunch: check-out', () => {
  it('within grace is on time', () => {
    expect(evaluatePunch('check_out', at('16:55'), schedule, rules, true).status).toBe('on_time');
  });
  it('before end - grace is early leave', () => {
    const r = evaluatePunch('check_out', at('16:30'), schedule, rules, true);
    expect(r).toMatchObject({ status: 'early_leave', earlyMinutes: 30 });
  });
  it('overtime counts only after the minimum', () => {
    expect(evaluatePunch('check_out', at('17:20'), schedule, rules, true).status).toBe('on_time');
    expect(evaluatePunch('check_out', at('17:45'), schedule, rules, true)).toMatchObject({ status: 'overtime', overtimeMinutes: 45 });
  });
  it('no overtime when the company does not allow it', () => {
    expect(evaluatePunch('check_out', at('19:00'), schedule, { ...rules, allowOvertime: false }, true).status).toBe('on_time');
  });
});

describe('evaluatePunch: lunch', () => {
  it('lunch-in after lunch end + grace is late', () => {
    expect(evaluatePunch('lunch_in', at('13:04'), schedule, rules, true).status).toBe('on_time');
    expect(evaluatePunch('lunch_in', at('13:10'), schedule, rules, true)).toMatchObject({ status: 'late', lateMinutes: 10 });
  });
});

describe('resolveScanType', () => {
  it('first scan of the day is check-in', () => {
    expect(resolveScanType([], at('07:50'), schedule, rules)).toBe('check_in');
  });
  it('around lunch it is lunch-out, then lunch-in', () => {
    const cin = punch('check_in', '07:55');
    expect(resolveScanType([cin], at('12:02'), schedule, rules)).toBe('lunch_out');
    expect(resolveScanType([cin, punch('lunch_out', '12:02')], at('12:58'), schedule, rules)).toBe('lunch_in');
  });
  it('lunch scans off -> check-out', () => {
    expect(resolveScanType([punch('check_in', '07:55')], at('12:02'), schedule, { ...rules, allowLunchScan: false })).toBe('check_out');
  });
  it('in the afternoon it is check-out', () => {
    expect(resolveScanType([punch('check_in', '07:55'), punch('lunch_out', '12:00'), punch('lunch_in', '13:00')], at('17:02'), schedule, rules)).toBe('check_out');
  });
  it('after lunch-out with no lunch-in, a scan after work is check-out', () => {
    expect(resolveScanType([punch('check_in', '07:55'), punch('lunch_out', '12:00')], at('17:10'), schedule, rules)).toBe('check_out');
  });
});

describe('validateScanType', () => {
  it('rejects a second check-in', () => {
    expect(validateScanType('check_in', [punch('check_in', '07:55')], rules, fmt)?.code).toBe('ALREADY_CHECKED_IN');
  });
  it('rejects lunch scans when disabled', () => {
    expect(validateScanType('lunch_out', [punch('check_in', '07:55')], { ...rules, allowLunchScan: false }, fmt)?.code).toBe('LUNCH_SCAN_DISABLED');
  });
  it('rejects lunch-in without lunch-out', () => {
    expect(validateScanType('lunch_in', [punch('check_in', '07:55')], rules, fmt)?.code).toBe('LUNCH_NOT_STARTED');
  });
  it('allows a later check-out (last out counts)', () => {
    expect(validateScanType('check_out', [punch('check_in', '07:55'), punch('check_out', '17:00')], rules, fmt)).toBeNull();
  });
});

describe('isEarlyCheckout', () => {
  it('flags check-out before end - grace on working days only', () => {
    expect(isEarlyCheckout(at('08:05'), schedule, true)).toBe(true);
    expect(isEarlyCheckout(at('16:56'), schedule, true)).toBe(false);
    expect(isEarlyCheckout(at('08:05'), schedule, false)).toBe(false);
  });
});
