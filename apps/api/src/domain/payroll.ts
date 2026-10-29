/**
 * Monthly pay for one employee (pure, unit-tested).
 *
 *   base pay      = salary - unpaid days x daily rate          (daily rate = salary / basis days)
 *   gross         = base pay - late/early deduction + overtime + allowances & bonuses
 *   NSSF          = % of gross in riel, clamped to the contribution floor / ceiling
 *   tax on salary = progressive brackets in riel on the taxable gross, after NSSF pension and dependant allowances
 *   net pay       = gross - employee NSSF - tax - deductions - advance repayments
 *
 * Tax and NSSF are worked out in KHR (Cambodian rules); pay in USD is converted with the month's exchange rate.
 */

export type TaxTreatment = 'salary' | 'exempt' | 'fringe';

export interface TaxBracket {
  /** Upper bound of the bracket in KHR per month; null = no upper bound. */
  upTo: number | null;
  /** Percent. */
  rate: number;
}

export interface PayrollRules {
  currency: string;
  baseFromAttendance: boolean;
  daysBasis: 'fixed' | 'schedule';
  fixedDays: number;
  unpaidLeaveTypes: string[];
  lateDeduction: boolean;
  lateMode: 'per_minute' | 'per_time';
  /** per_minute: multiplier of the per-minute rate. per_time: amount per late / early time. */
  lateValue: number;
  /** Free minutes (per_minute) or free times (per_time) each month. */
  lateFree: number;
  includeEarlyLeave: boolean;
  overtime: boolean;
  allowances: boolean;
  deductions: boolean;
  tax: boolean;
  nssf: boolean;
  taxBrackets: TaxBracket[];
  /** KHR per dependant (non-working spouse, children). */
  dependentAllowance: number;
  nonResidentRate: number;
  fringeRate: number;
  pensionDeductible: boolean;
  nssfPensionEmployee: number;
  nssfPensionEmployer: number;
  nssfHealthEmployer: number;
  nssfRiskEmployer: number;
  nssfMinWage: number;
  nssfMaxWage: number;
}

/** Cambodian Tax on Salary brackets (KHR / month) and NSSF rates as of 2026. Editable in Settings. */
export const DEFAULT_TAX_BRACKETS: TaxBracket[] = [
  { upTo: 1_500_000, rate: 0 },
  { upTo: 2_000_000, rate: 5 },
  { upTo: 8_500_000, rate: 10 },
  { upTo: 12_500_000, rate: 15 },
  { upTo: null, rate: 20 },
];

export const DEFAULT_PAYROLL_RULES: PayrollRules = {
  currency: 'USD',
  baseFromAttendance: true,
  daysBasis: 'fixed',
  fixedDays: 26,
  unpaidLeaveTypes: ['unpaid'],
  lateDeduction: false,
  lateMode: 'per_minute',
  lateValue: 1,
  lateFree: 0,
  includeEarlyLeave: true,
  overtime: true,
  allowances: true,
  deductions: true,
  tax: true,
  nssf: true,
  taxBrackets: DEFAULT_TAX_BRACKETS,
  dependentAllowance: 150_000,
  nonResidentRate: 20,
  fringeRate: 20,
  pensionDeductible: true,
  nssfPensionEmployee: 2,
  nssfPensionEmployer: 2,
  nssfHealthEmployer: 2.6,
  nssfRiskEmployer: 0.8,
  nssfMinWage: 400_000,
  nssfMaxWage: 1_200_000,
};

export interface PayItem {
  /** Pay item or salary advance id. */
  id?: string;
  name: string;
  amount: number;
  /** Earnings only. */
  tax?: TaxTreatment;
  /** Advances: what is still owed after this month. */
  balance?: number;
}

export interface PayInput {
  salary: number | null;
  /** For late deductions (salary / hours per month, or the employee's own rate). */
  hourlyRate: number | null;
  basisDays: number;
  unpaidDays: number;
  lateMinutes: number;
  earlyMinutes: number;
  lateTimes: number;
  earlyTimes: number;
  otPay: number | null;
  earnings: PayItem[];
  deductions: PayItem[];
  advances: PayItem[];
  dependents: number;
  resident: boolean;
  nssfEnrolled: boolean;
}

export interface PayResult {
  salary: number;
  dailyRate: number;
  unpaidDays: number;
  absenceDeduction: number;
  basePay: number;
  lateChargeable: number;
  lateDeduction: number;
  otPay: number;
  earnings: PayItem[];
  earningsTotal: number;
  gross: number;
  taxableGross: number;
  nssf: { wageKhr: number; employeeKhr: number; employee: number; pensionEmployerKhr: number; healthKhr: number; riskKhr: number; employerKhr: number; employer: number };
  tax: { baseKhr: number; dependentsKhr: number; taxKhr: number; tax: number; resident: boolean };
  fringe: { amount: number; taxKhr: number; tax: number };
  deductions: PayItem[];
  deductionsTotal: number;
  advances: PayItem[];
  advancesTotal: number;
  totalDeductions: number;
  net: number;
  netKhr: number;
  /** Employer cost on top of gross: employer NSSF + fringe benefit tax. */
  employerCost: number;
  warnings: string[];
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (items: { amount: number }[]) => round2(items.reduce((s, i) => s + i.amount, 0));

/** Progressive tax in KHR. */
export function salaryTaxKhr(taxableKhr: number, brackets: TaxBracket[]): number {
  if (taxableKhr <= 0) return 0;
  const sorted = [...brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  let tax = 0;
  let lower = 0;
  for (const b of sorted) {
    const upper = b.upTo ?? Infinity;
    if (taxableKhr > lower) tax += (Math.min(taxableKhr, upper) - lower) * (b.rate / 100);
    lower = upper;
    if (taxableKhr <= upper) break;
  }
  return Math.round(tax);
}

/** Wage NSSF contributions are based on: the monthly wage clamped to the floor / ceiling. */
export function nssfWage(wageKhr: number, rules: Pick<PayrollRules, 'nssfMinWage' | 'nssfMaxWage'>): number {
  if (wageKhr <= 0) return 0;
  return Math.min(Math.max(Math.round(wageKhr), rules.nssfMinWage), rules.nssfMaxWage);
}

/** Tax and NSSF need riel: they only apply to companies paying in USD or KHR. */
export const supportsKhTax = (currency: string) => currency === 'USD' || currency === 'KHR';

export function computePay(input: PayInput, rules: PayrollRules, exchangeRate: number): PayResult {
  const warnings: string[] = [];
  const rate = rules.currency === 'KHR' ? 1 : exchangeRate;
  const toKhr = (amount: number) => amount * rate;
  const fromKhr = (khr: number) => round2(khr / rate);

  const salary = input.salary ?? 0;
  if (input.salary == null) warnings.push('No monthly salary set');
  const basisDays = Math.max(1, input.basisDays);
  const dailyRate = salary / basisDays;
  const unpaidDays = rules.baseFromAttendance ? Math.min(Math.max(0, input.unpaidDays), basisDays) : 0;
  const absenceDeduction = round2(Math.min(salary, unpaidDays * dailyRate));
  const basePay = round2(salary - absenceDeduction);

  let lateChargeable = 0;
  let lateDeduction = 0;
  if (rules.lateDeduction) {
    if (rules.lateMode === 'per_minute') {
      lateChargeable = Math.max(0, input.lateMinutes + (rules.includeEarlyLeave ? input.earlyMinutes : 0) - rules.lateFree);
      if (lateChargeable > 0 && input.hourlyRate == null) warnings.push('Late minutes not deducted: no salary or hourly rate');
      else lateDeduction = (lateChargeable * (input.hourlyRate ?? 0) / 60) * rules.lateValue;
    } else {
      lateChargeable = Math.max(0, input.lateTimes + (rules.includeEarlyLeave ? input.earlyTimes : 0) - rules.lateFree);
      lateDeduction = lateChargeable * rules.lateValue;
    }
    lateDeduction = round2(Math.min(lateDeduction, basePay));
  }

  let otPay = 0;
  if (rules.overtime) {
    if (input.otPay == null) warnings.push('Overtime not priced: no salary or hourly rate');
    else otPay = round2(input.otPay);
  }
  const earnings = rules.allowances ? input.earnings.filter((e) => e.amount !== 0) : [];
  const earningsTotal = sum(earnings);
  const gross = round2(basePay - lateDeduction + otPay + earningsTotal);
  const taxableGross = round2(basePay - lateDeduction + otPay + sum(earnings.filter((e) => (e.tax ?? 'salary') === 'salary')));
  const fringeAmount = sum(earnings.filter((e) => e.tax === 'fringe'));

  const khTax = supportsKhTax(rules.currency);
  if (!khTax && (rules.tax || rules.nssf)) warnings.push(`Tax and NSSF are only worked out for USD or KHR pay (company pays in ${rules.currency})`);

  const nssf = { wageKhr: 0, employeeKhr: 0, employee: 0, pensionEmployerKhr: 0, healthKhr: 0, riskKhr: 0, employerKhr: 0, employer: 0 };
  if (khTax && rules.nssf && input.nssfEnrolled) {
    nssf.wageKhr = nssfWage(toKhr(gross), rules);
    nssf.employeeKhr = Math.round(nssf.wageKhr * rules.nssfPensionEmployee / 100);
    nssf.pensionEmployerKhr = Math.round(nssf.wageKhr * rules.nssfPensionEmployer / 100);
    nssf.healthKhr = Math.round(nssf.wageKhr * rules.nssfHealthEmployer / 100);
    nssf.riskKhr = Math.round(nssf.wageKhr * rules.nssfRiskEmployer / 100);
    nssf.employerKhr = nssf.pensionEmployerKhr + nssf.healthKhr + nssf.riskKhr;
    nssf.employee = fromKhr(nssf.employeeKhr);
    nssf.employer = fromKhr(nssf.employerKhr);
  }

  const tax = { baseKhr: 0, dependentsKhr: 0, taxKhr: 0, tax: 0, resident: input.resident };
  const fringe = { amount: fringeAmount, taxKhr: 0, tax: 0 };
  if (khTax && rules.tax) {
    const taxableKhr = Math.round(toKhr(taxableGross));
    if (input.resident) {
      tax.dependentsKhr = Math.max(0, input.dependents) * rules.dependentAllowance;
      tax.baseKhr = Math.max(0, taxableKhr - (rules.pensionDeductible ? nssf.employeeKhr : 0) - tax.dependentsKhr);
      tax.taxKhr = salaryTaxKhr(tax.baseKhr, rules.taxBrackets);
    } else {
      tax.baseKhr = Math.max(0, taxableKhr);
      tax.taxKhr = Math.round(tax.baseKhr * rules.nonResidentRate / 100);
    }
    tax.tax = fromKhr(tax.taxKhr);
    if (fringeAmount > 0) {
      fringe.taxKhr = Math.round(toKhr(fringeAmount) * rules.fringeRate / 100);
      fringe.tax = fromKhr(fringe.taxKhr);
    }
  }

  const deductions = rules.deductions ? input.deductions.filter((d) => d.amount > 0) : [];
  const advances = rules.deductions ? input.advances.filter((d) => d.amount > 0) : [];
  const deductionsTotal = sum(deductions);
  const advancesTotal = sum(advances);
  const totalDeductions = round2(nssf.employee + tax.tax + deductionsTotal + advancesTotal);
  const net = round2(gross - totalDeductions);
  if (net < 0) warnings.push('Deductions are more than the pay for this month');

  return {
    salary, dailyRate: round2(dailyRate), unpaidDays, absenceDeduction, basePay, lateChargeable, lateDeduction, otPay, earnings, earningsTotal,
    gross, taxableGross, nssf, tax, fringe, deductions, deductionsTotal, advances, advancesTotal, totalDeductions, net,
    netKhr: Math.round(toKhr(net)), employerCost: round2(nssf.employer + fringe.tax), warnings,
  };
}
