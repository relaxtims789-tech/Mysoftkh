import { DayContext, DayPunch, summarizeDay } from './daily-summary';
import { evaluatePunch, PunchRules, Schedule } from './punch-rules';
import { timeToMinutes } from './time';

const schedule: Schedule = {
  startTime: '08:00', endTime: '17:00', lunchStart: '12:00', lunchEnd: '13:00',
  lateAfterMinutes: 15, graceMinutes: 5, workDays: [1, 2, 3, 4, 5],
};
const rules: PunchRules = { allowLunchScan: true, allowOvertime: true, overtimeMinMinutes: 30 };
const ctx = (over: Partial<DayContext> = {}): DayContext => ({
  date: '2026-10-05', when: 'past', schedule, weekday: 1, holiday: null, leave: null, rules, ...over,
});
let n = 0;
function p(type: DayPunch['type'], t: string, working = true): DayPunch {
  const e = evaluatePunch(type, timeToMinutes(t), schedule, rules, working);
  return { id: String(++n), type, time: new Date(`2026-10-05T${t}:00+07:00`), minutes: timeToMinutes(t), ...e };
}

describe('summarizeDay', () => {
  it('on time, full day with scheduled lunch deducted', () => {
    const s = summarizeDay(ctx(), [p('check_in', '07:55'), p('check_out', '17:05')]);
    expect(s.status).toBe('present');
    expect(s.workedMinutes).toBe(9 * 60 + 10 - 60);
    expect(s.flags).toEqual([]);
  });

  it('late with early leave', () => {
    const s = summarizeDay(ctx(), [p('check_in', '08:20'), p('check_out', '16:00')]);
    expect(s.status).toBe('late');
    expect(s.lateMinutes).toBe(20);
    expect(s.earlyMinutes).toBe(60);
    expect(s.flags).toContain('early_leave');
  });

  it('uses actual lunch scans when present', () => {
    const s = summarizeDay(ctx(), [p('check_in', '08:00'), p('lunch_out', '12:00'), p('lunch_in', '12:30'), p('check_out', '17:00')]);
    expect(s.workedMinutes).toBe(9 * 60 - 30);
  });

  it('last check-out counts; overtime from it', () => {
    const s = summarizeDay(ctx(), [p('check_in', '08:00'), p('check_out', '17:00'), p('check_out', '18:30')]);
    expect(s.overtimeMinutes).toBe(90);
    expect(s.flags).toContain('overtime');
  });

  it('missing check-out on a past day', () => {
    expect(summarizeDay(ctx(), [p('check_in', '08:00')]).flags).toContain('missing_check_out');
  });

  it('no scans: absent / not yet / leave / holiday / day off', () => {
    expect(summarizeDay(ctx(), []).status).toBe('absent');
    expect(summarizeDay(ctx({ when: 'today', nowMinutes: timeToMinutes('08:10') }), []).status).toBe('not_yet');
    expect(summarizeDay(ctx({ when: 'today', nowMinutes: timeToMinutes('08:16') }), []).status).toBe('absent');
    expect(summarizeDay(ctx({ leave: { type: 'sick' } }), []).status).toBe('leave');
    expect(summarizeDay(ctx({ holiday: 'Water Festival' }), []).status).toBe('holiday');
    expect(summarizeDay(ctx({ weekday: 7 }), []).status).toBe('day_off');
    expect(summarizeDay(ctx({ when: 'future' }), []).status).toBe('upcoming');
  });

  it('leave over a weekend is not counted as leave on the days off', () => {
    expect(summarizeDay(ctx({ weekday: 7, leave: { type: 'annual' } }), []).status).toBe('day_off');
    expect(summarizeDay(ctx({ holiday: 'Independence Day', leave: { type: 'annual' } }), []).status).toBe('holiday');
  });

  it('work on a day off is all overtime', () => {
    const s = summarizeDay(ctx({ weekday: 6 }), [p('check_in', '09:00', false), p('check_out', '12:00', false)]);
    expect(s.status).toBe('present');
    expect(s.overtimeMinutes).toBe(180);
    expect(s.lateMinutes).toBe(0);
  });
});
