import { DEFAULT_OT_POLICY, hourlyRate, OtPolicy, otPayForDay, sumOt } from './overtime-pay';

const policy: OtPolicy = {
  ...DEFAULT_OT_POLICY,
  workDay: { mode: 'multiplier', value: 1.5, minHours: 0 },
  dayOff: { mode: 'fixed_day', value: 15, minHours: 4 },
  holiday: { mode: 'multiplier', value: 2, minHours: 0 },
};

describe('hourly rate', () => {
  it('uses the hourly rate, else salary / hours per month', () => {
    expect(hourlyRate({ monthlySalary: 416, hourlyRate: null }, { monthlyHours: 208 })).toBe(2);
    expect(hourlyRate({ monthlySalary: 416, hourlyRate: 3 }, { monthlyHours: 208 })).toBe(3);
    expect(hourlyRate({ monthlySalary: null, hourlyRate: null }, { monthlyHours: 208 })).toBeNull();
  });
});

describe('otPayForDay', () => {
  it('work day x1.5: 90 min at $2/h = 1.5 h, 2.25 weighted, $4.50', () => {
    expect(otPayForDay(90, 'work_day', policy, 2)).toEqual({ hours: 1.5, weightedHours: 2.25, paidDays: 0, amount: 4.5 });
  });

  it('holiday x2: 4 h at $2/h = $16', () => {
    expect(otPayForDay(240, 'holiday', policy, 2)).toMatchObject({ weightedHours: 8, amount: 16 });
  });

  it('day off fixed $15 per day when at least 4 h are worked', () => {
    expect(otPayForDay(300, 'day_off', policy, null)).toEqual({ hours: 5, weightedHours: null, paidDays: 1, amount: 15 });
    expect(otPayForDay(180, 'day_off', policy, null)).toMatchObject({ paidDays: 0, amount: 0 });
  });

  it('fixed amount per hour needs no salary', () => {
    const p = { ...policy, workDay: { mode: 'fixed_hour' as const, value: 3, minHours: 0 } };
    expect(otPayForDay(30, 'work_day', p, null)).toMatchObject({ hours: 0.5, amount: 1.5 });
  });

  it('a multiplier without an hourly rate gives hours but no amount', () => {
    expect(otPayForDay(60, 'work_day', policy, null)).toMatchObject({ weightedHours: 1.5, amount: null });
  });

  it('a work day never pays per day', () => {
    const p = { ...policy, workDay: { mode: 'fixed_day' as const, value: 50, minHours: 0 } };
    expect(otPayForDay(60, 'work_day', p, 2)).toMatchObject({ paidDays: 0, amount: 100 });
  });
});

describe('sumOt', () => {
  it('splits hours by kind of day and totals pay', () => {
    const t = sumOt([
      { dayType: 'work_day', pay: otPayForDay(90, 'work_day', policy, 2) },
      { dayType: 'work_day', pay: otPayForDay(30, 'work_day', policy, 2) },
      { dayType: 'day_off', pay: otPayForDay(300, 'day_off', policy, 2) },
      { dayType: 'holiday', pay: otPayForDay(120, 'holiday', policy, 2) },
    ]);
    expect(t).toMatchObject({ workDayHours: 2, dayOffHours: 5, holidayHours: 2, otDays: 4, paidDays: 1, weightedHours: 7, amount: 6 + 15 + 8, missingRate: false });
  });

  it('flags a missing rate instead of guessing', () => {
    const t = sumOt([{ dayType: 'work_day', pay: otPayForDay(60, 'work_day', policy, null) }]);
    expect(t).toMatchObject({ amount: 0, missingRate: true });
  });
});
