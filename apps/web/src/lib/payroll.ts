/** Payroll types shared by the admin pages and the employee payslip screens. */

import { t } from './i18n';

export type TaxTreatment = 'salary' | 'exempt' | 'fringe';

export interface PayItem { id?: string; name: string; amount: number; tax?: TaxTreatment; balance?: number }

export interface PayLine {
  employeeId: string; employeeCode: string; name: string; department: string | null; position: string | null; branch: string | null;
  bank: { name: string | null; account: string; accountName: string | null } | null;
  dependents: number; nssfEnrolled: boolean; hourlyRate: number | null;
  days: { basis: number; scheduled: number; worked: number; paidLeave: number; unpaidLeave: number; absent: number; notEmployed: number; holidays: number; upcoming: number };
  late: { minutes: number; earlyMinutes: number; times: number; earlyTimes: number };
  ot: { workDayHours: number; dayOffHours: number; holidayHours: number; weightedHours: number; pendingDays: number };
  salary: number; dailyRate: number; unpaidDays: number; absenceDeduction: number; basePay: number; lateChargeable: number; lateDeduction: number;
  otPay: number; earnings: PayItem[]; earningsTotal: number; gross: number; taxableGross: number;
  nssf: { wageKhr: number; employeeKhr: number; employee: number; pensionEmployerKhr: number; healthKhr: number; riskKhr: number; employerKhr: number; employer: number };
  tax: { baseKhr: number; dependentsKhr: number; taxKhr: number; tax: number; resident: boolean };
  fringe: { amount: number; taxKhr: number; tax: number };
  deductions: PayItem[]; deductionsTotal: number; advances: PayItem[]; advancesTotal: number; totalDeductions: number;
  net: number; netKhr: number; employerCost: number; warnings: string[];
}

export interface RunTotals {
  employees: number; salary: number; basePay: number; absenceDeduction: number; lateDeduction: number; otPay: number; earnings: number; gross: number;
  nssfEmployee: number; nssfEmployer: number; nssfEmployeeKhr: number; nssfEmployerKhr: number; tax: number; taxKhr: number; fringeTax: number;
  deductions: number; advances: number; net: number; netKhr: number; employerCost: number; bankCount: number; bankTotal: number; cashCount: number;
  cashTotal: number; warnings: number; pendingOtDays: number;
}

export type RunStatus = 'draft' | 'approved' | 'paid';

export interface PayrollRun {
  id: string; month: string; status: RunStatus; currency: string; exchangeRate: number; totals: RunTotals; note: string | null;
  calculatedAt: string | null; calculatedBy: string | null; approvedAt: string | null; approvedBy: string | null; paidAt: string | null; paidBy: string | null;
}

export const RUN_STATUS: Record<RunStatus, [string, string]> = {
  draft: [t('Draft'), 'warn'],
  approved: [t('Approved · locked'), 'info'],
  paid: [t('Paid · locked'), 'good'],
};

export const TAX_LABEL: Record<TaxTreatment, string> = {
  salary: t('Taxed with salary'),
  exempt: t('Tax-free'),
  fringe: t('Fringe benefit (20%, employer pays)'),
};

export function money(n: number | null | undefined, currency = 'USD'): string {
  if (n == null || Number.isNaN(n)) return '—';
  return currency === 'KHR'
    ? Math.round(n).toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const riel = (n: number) => `${Math.round(n).toLocaleString('en-US')} ៛`;

/** The month before the current one (payroll is normally run after the month ends). */
export function previousMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1)).toISOString().slice(0, 7);
}
