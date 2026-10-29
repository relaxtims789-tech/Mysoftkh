import { computePay, DEFAULT_PAYROLL_RULES, nssfWage, PayInput, PayrollRules, salaryTaxKhr } from './payroll';

const rules = (over: Partial<PayrollRules> = {}): PayrollRules => ({ ...DEFAULT_PAYROLL_RULES, ...over });
const input = (over: Partial<PayInput> = {}): PayInput => ({
  salary: 520, hourlyRate: 2.5, basisDays: 26, unpaidDays: 0, lateMinutes: 0, earlyMinutes: 0, lateTimes: 0, earlyTimes: 0, otPay: 0,
  earnings: [], deductions: [], advances: [], dependents: 0, resident: true, nssfEnrolled: true, ...over,
});

describe('salaryTaxKhr (Cambodian brackets)', () => {
  it('is progressive', () => {
    const b = DEFAULT_PAYROLL_RULES.taxBrackets;
    expect(salaryTaxKhr(1_500_000, b)).toBe(0);
    expect(salaryTaxKhr(2_000_000, b)).toBe(25_000);
    expect(salaryTaxKhr(2_500_000, b)).toBe(75_000); // = 2.5M x 10% - 175,000
    expect(salaryTaxKhr(8_500_000, b)).toBe(675_000);
    expect(salaryTaxKhr(13_500_000, b)).toBe(1_475_000);
    expect(salaryTaxKhr(-5, b)).toBe(0);
  });
});

describe('nssfWage', () => {
  it('clamps to floor and ceiling', () => {
    expect(nssfWage(300_000, DEFAULT_PAYROLL_RULES)).toBe(400_000);
    expect(nssfWage(900_000, DEFAULT_PAYROLL_RULES)).toBe(900_000);
    expect(nssfWage(2_000_000, DEFAULT_PAYROLL_RULES)).toBe(1_200_000);
    expect(nssfWage(0, DEFAULT_PAYROLL_RULES)).toBe(0);
  });
});

describe('computePay', () => {
  it('works out a full USD payslip with tax in riel', () => {
    const r = computePay(
      input({
        unpaidDays: 1, otPay: 30, dependents: 1,
        earnings: [{ name: 'Transport', amount: 20, tax: 'salary' }, { name: 'Meal', amount: 10, tax: 'exempt' }],
        deductions: [{ name: 'Uniform', amount: 5 }], advances: [{ name: 'Advance', amount: 50 }],
      }),
      rules(), 4100,
    );
    expect(r.dailyRate).toBe(20);
    expect(r.absenceDeduction).toBe(20);
    expect(r.basePay).toBe(500);
    expect(r.gross).toBe(560);
    expect(r.taxableGross).toBe(550);
    expect(r.nssf.wageKhr).toBe(1_200_000);
    expect(r.nssf.employeeKhr).toBe(24_000);
    expect(r.nssf.employee).toBe(5.85);
    expect(r.nssf.employerKhr).toBe(24_000 + 31_200 + 9_600);
    // 2,255,000 - 24,000 pension - 150,000 dependant = 2,081,000 -> 25,000 + 8,100
    expect(r.tax.baseKhr).toBe(2_081_000);
    expect(r.tax.taxKhr).toBe(33_100);
    expect(r.tax.tax).toBe(8.07);
    expect(r.totalDeductions).toBe(68.92);
    expect(r.net).toBe(491.08);
    expect(r.netKhr).toBe(2_013_428);
    expect(r.warnings).toEqual([]);
  });

  it('deducts late and early minutes after the free minutes', () => {
    const r = computePay(input({ lateMinutes: 30, earlyMinutes: 15 }), rules({ lateDeduction: true, lateFree: 10, tax: false, nssf: false }), 4100);
    expect(r.lateChargeable).toBe(35);
    expect(r.lateDeduction).toBe(1.46);
    expect(r.gross).toBe(518.54);
    const noEarly = computePay(input({ lateMinutes: 30, earlyMinutes: 15 }), rules({ lateDeduction: true, includeEarlyLeave: false, tax: false, nssf: false }), 4100);
    expect(noEarly.lateChargeable).toBe(30);
  });

  it('deducts a fixed amount per late time', () => {
    const r = computePay(input({ lateTimes: 3, earlyTimes: 1 }), rules({ lateDeduction: true, lateMode: 'per_time', lateValue: 2, lateFree: 2, tax: false, nssf: false }), 4100);
    expect(r.lateChargeable).toBe(2);
    expect(r.lateDeduction).toBe(4);
  });

  it('taxes non-residents at a flat rate without allowances', () => {
    const r = computePay(input({ salary: 1000, dependents: 2, resident: false }), rules({ nssf: false }), 4000);
    expect(r.tax.taxKhr).toBe(800_000);
    expect(r.tax.tax).toBe(200);
    expect(r.net).toBe(800);
  });

  it('pays in riel without an exchange rate', () => {
    const r = computePay(input({ salary: 2_000_000, hourlyRate: null }), rules({ currency: 'KHR' }), 4100);
    expect(r.nssf.employeeKhr).toBe(24_000);
    expect(r.nssf.employee).toBe(24_000);
    expect(r.tax.taxKhr).toBe(23_800); // (2,000,000 - 24,000 - 1,500,000) x 5%
    expect(r.net).toBe(2_000_000 - 24_000 - 23_800);
  });

  it('charges fringe benefit tax to the employer', () => {
    const r = computePay(input({ salary: 300, earnings: [{ name: 'Housing', amount: 100, tax: 'fringe' }] }), rules({ nssf: false }), 4000);
    expect(r.fringe.taxKhr).toBe(80_000);
    expect(r.fringe.tax).toBe(20);
    expect(r.employerCost).toBe(20);
    expect(r.taxableGross).toBe(300);
    expect(r.gross).toBe(400);
  });

  it('leaves out items whose option is off', () => {
    const r = computePay(
      input({ unpaidDays: 2, otPay: 40, earnings: [{ name: 'Bonus', amount: 50 }], deductions: [{ name: 'Loss', amount: 10 }], advances: [{ name: 'Advance', amount: 30 }] }),
      rules({ baseFromAttendance: false, overtime: false, allowances: false, deductions: false, tax: false, nssf: false }), 4100,
    );
    expect(r.basePay).toBe(520);
    expect(r.gross).toBe(520);
    expect(r.net).toBe(520);
  });

  it('warns instead of guessing', () => {
    const r = computePay(input({ salary: null, otPay: null, advances: [{ name: 'Advance', amount: 10 }] }), rules({ currency: 'THB' }), 1);
    expect(r.gross).toBe(0);
    expect(r.net).toBe(-10);
    expect(r.warnings).toEqual(expect.arrayContaining(['No monthly salary set', 'Overtime not priced: no salary or hourly rate', 'Deductions are more than the pay for this month']));
    expect(r.warnings.some((w) => w.includes('THB'))).toBe(true);
  });
});
