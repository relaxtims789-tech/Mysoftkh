import { addMonthsIso, billingStatus, branchLimit, priceFor, renewalPeriod, tierFor, upgradePrice } from './billing';

describe('billingStatus', () => {
  const s = (over: object, today: string) => billingStatus({ exempt: false, trialEndsAt: null, paidUntil: null, ...over }, today, 7);

  it('exempt companies are never limited', () => {
    expect(billingStatus({ exempt: true, trialEndsAt: null, paidUntil: null }, '2026-10-07', 7)).toMatchObject({ state: 'exempt', readOnly: false });
  });
  it('trial, then grace, then read-only', () => {
    expect(s({ trialEndsAt: '2026-10-31' }, '2026-10-07')).toMatchObject({ state: 'trial', daysLeft: 24, readOnly: false });
    expect(s({ trialEndsAt: '2026-10-31' }, '2026-10-31')).toMatchObject({ state: 'trial', daysLeft: 0 });
    expect(s({ trialEndsAt: '2026-10-31' }, '2026-11-07')).toMatchObject({ state: 'grace', graceUntil: '2026-11-07', readOnly: false });
    expect(s({ trialEndsAt: '2026-10-31' }, '2026-11-08')).toMatchObject({ state: 'expired', readOnly: true });
  });
  it('paid cover wins over the trial', () => {
    expect(s({ trialEndsAt: '2026-10-31', paidUntil: '2026-12-15' }, '2026-11-20')).toMatchObject({ state: 'active', coveredUntil: '2026-12-15' });
    expect(s({ trialEndsAt: '2026-10-31', paidUntil: '2026-09-30' }, '2026-10-07')).toMatchObject({ state: 'trial' });
  });
  it('a company with nothing is read-only', () => {
    expect(s({}, '2026-10-07')).toMatchObject({ state: 'expired', readOnly: true });
  });
});

describe('prices and periods', () => {
  const tiers = [
    { id: 'a', minStaff: 1, maxStaff: 5, monthlyPrice: 9 },
    { id: 'b', minStaff: 6, maxStaff: 10, monthlyPrice: 15 },
    { id: 'c', minStaff: 11, maxStaff: 15, monthlyPrice: 20 },
  ];
  it('picks the smallest tier that fits', () => {
    expect(tierFor(tiers, 1)?.id).toBe('a');
    expect(tierFor(tiers, 5)?.id).toBe('a');
    expect(tierFor(tiers, 6)?.id).toBe('b');
    expect(tierFor(tiers, 99)?.id).toBe('c');
  });
  it('yearly gives free months', () => {
    expect(priceFor(tiers[1], 'monthly', 2)).toEqual({ months: 1, amount: 15, fullAmount: 15 });
    expect(priceFor(tiers[1], 'yearly', 2)).toEqual({ months: 12, amount: 150, fullAmount: 180 });
  });
  it('adds months clamped to month end', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2026-10-07', 12)).toBe('2027-10-07');
  });
  it('renewal starts after the current cover, or today when lapsed', () => {
    expect(renewalPeriod({ exempt: false, trialEndsAt: '2026-10-31', paidUntil: null }, '2026-10-07', 1)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(renewalPeriod({ exempt: false, trialEndsAt: '2026-09-30', paidUntil: null }, '2026-10-07', 1)).toEqual({ start: '2026-10-07', end: '2026-11-06' });
    expect(renewalPeriod({ exempt: false, trialEndsAt: null, paidUntil: '2026-12-31' }, '2026-10-07', 12)).toEqual({ start: '2027-01-01', end: '2027-12-31' });
  });
  it('upgrade costs the difference for the months left', () => {
    expect(upgradePrice(tiers[0], tiers[2], '2026-10-07', '2026-11-06')).toEqual({ months: 1, amount: 11 });
    expect(upgradePrice(tiers[0], tiers[2], '2026-10-07', '2027-01-06')).toEqual({ months: 3, amount: 33 });
  });
});

describe('branchLimit', () => {
  const base = { custom: false, customLimit: null, exempt: false, planMax: 1, hasPlan: true };
  it('follows the plan unless the super admin set a number', () => {
    expect(branchLimit(base)).toBe(1);
    expect(branchLimit({ ...base, planMax: null })).toBeNull();
    expect(branchLimit({ ...base, custom: true, customLimit: 5 })).toBe(5);
    expect(branchLimit({ ...base, custom: true, customLimit: null })).toBeNull();
  });
  it('does not limit free-plan companies or companies without a plan', () => {
    expect(branchLimit({ ...base, exempt: true })).toBeNull();
    expect(branchLimit({ ...base, hasPlan: false })).toBeNull();
    expect(branchLimit({ ...base, exempt: true, custom: true, customLimit: 2 })).toBe(2);
  });
});
