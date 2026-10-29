import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../../database/db.service';
import { AuthUser, requireEmployee } from '../../common/auth';
import { badRequest, notFound } from '../../common/errors';
import { computePay, DEFAULT_PAYROLL_RULES, PayItem, PayResult, PayrollRules, round2, TaxBracket, TaxTreatment } from '../../domain/payroll';
import { dateRange, isoWeekday } from '../../domain/time';
import { AuditService, diff } from '../audit/audit.service';
import { AttendanceSummaryService } from '../attendance/summary.service';
import { CompanyContextService } from '../core/company-context.service';
import { TelegramService } from '../core/telegram.service';
import { tgMessages } from '../core/telegram-messages';
import { OvertimeService } from '../overtime/overtime.service';

export type RunStatus = 'draft' | 'approved' | 'paid';

export interface PayrollSettings extends PayrollRules {
  /** KHR per USD suggested for new months. */
  exchangeRate: number;
}

export interface PayLine extends PayResult {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  position: string | null;
  branch: string | null;
  bank: { name: string | null; account: string; accountName: string | null } | null;
  dependents: number;
  nssfEnrolled: boolean;
  hourlyRate: number | null;
  days: { basis: number; scheduled: number; worked: number; paidLeave: number; unpaidLeave: number; absent: number; notEmployed: number; holidays: number; upcoming: number };
  late: { minutes: number; earlyMinutes: number; times: number; earlyTimes: number };
  ot: { workDayHours: number; dayOffHours: number; holidayHours: number; weightedHours: number; pendingDays: number };
}

export interface RunTotals {
  employees: number;
  salary: number;
  basePay: number;
  absenceDeduction: number;
  lateDeduction: number;
  otPay: number;
  earnings: number;
  gross: number;
  nssfEmployee: number;
  nssfEmployer: number;
  nssfEmployeeKhr: number;
  nssfEmployerKhr: number;
  tax: number;
  taxKhr: number;
  fringeTax: number;
  deductions: number;
  advances: number;
  net: number;
  netKhr: number;
  employerCost: number;
  bankCount: number;
  bankTotal: number;
  cashCount: number;
  cashTotal: number;
  warnings: number;
  pendingOtDays: number;
}

export interface ItemInput {
  employeeId: string;
  month: string;
  kind: 'earning' | 'deduction';
  name: string;
  amount: number;
  tax?: TaxTreatment;
}

export interface AdvanceInput {
  employeeId: string;
  amount: number;
  installment: number;
  startMonth: string;
  issuedOn: string;
  note?: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthBounds(month: string): { from: string; to: string; start: string } {
  if (!MONTH.test(month)) throw badRequest('Month must be YYYY-MM.', 'BAD_MONTH');
  const start = `${month}-01`;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0);
  return { from: start, to: next.toISOString().slice(0, 10), start };
}

function rowToSettings(r: any, currency: string): PayrollSettings {
  if (!r) return { ...DEFAULT_PAYROLL_RULES, currency, exchangeRate: 4100 };
  return {
    currency,
    baseFromAttendance: r.base_from_attendance,
    daysBasis: r.days_basis,
    fixedDays: Number(r.fixed_days),
    unpaidLeaveTypes: r.unpaid_leave_types ?? ['unpaid'],
    lateDeduction: r.late_deduction,
    lateMode: r.late_mode,
    lateValue: Number(r.late_value),
    lateFree: r.late_free,
    includeEarlyLeave: r.include_early_leave,
    overtime: r.overtime,
    allowances: r.allowances,
    deductions: r.deductions,
    tax: r.tax,
    nssf: r.nssf,
    taxBrackets: r.tax_brackets as TaxBracket[],
    dependentAllowance: Number(r.dependent_allowance),
    nonResidentRate: Number(r.non_resident_rate),
    fringeRate: Number(r.fringe_rate),
    pensionDeductible: r.pension_deductible,
    nssfPensionEmployee: Number(r.nssf_pension_employee),
    nssfPensionEmployer: Number(r.nssf_pension_employer),
    nssfHealthEmployer: Number(r.nssf_health_employer),
    nssfRiskEmployer: Number(r.nssf_risk_employer),
    nssfMinWage: Number(r.nssf_min_wage),
    nssfMaxWage: Number(r.nssf_max_wage),
    exchangeRate: Number(r.exchange_rate),
  };
}

export function totalsOf(lines: PayLine[]): RunTotals {
  const t: RunTotals = {
    employees: lines.length, salary: 0, basePay: 0, absenceDeduction: 0, lateDeduction: 0, otPay: 0, earnings: 0, gross: 0, nssfEmployee: 0, nssfEmployer: 0,
    nssfEmployeeKhr: 0, nssfEmployerKhr: 0, tax: 0, taxKhr: 0, fringeTax: 0, deductions: 0, advances: 0, net: 0, netKhr: 0, employerCost: 0,
    bankCount: 0, bankTotal: 0, cashCount: 0, cashTotal: 0, warnings: 0, pendingOtDays: 0,
  };
  for (const l of lines) {
    t.salary += l.salary;
    t.basePay += l.basePay;
    t.absenceDeduction += l.absenceDeduction;
    t.lateDeduction += l.lateDeduction;
    t.otPay += l.otPay;
    t.earnings += l.earningsTotal;
    t.gross += l.gross;
    t.nssfEmployee += l.nssf.employee;
    t.nssfEmployer += l.nssf.employer;
    t.nssfEmployeeKhr += l.nssf.employeeKhr;
    t.nssfEmployerKhr += l.nssf.employerKhr;
    t.tax += l.tax.tax;
    t.taxKhr += l.tax.taxKhr;
    t.fringeTax += l.fringe.tax;
    t.deductions += l.deductionsTotal;
    t.advances += l.advancesTotal;
    t.net += l.net;
    t.netKhr += l.netKhr;
    t.employerCost += l.employerCost;
    if (l.net > 0 && l.bank) { t.bankCount++; t.bankTotal += l.net; }
    if (l.net > 0 && !l.bank) { t.cashCount++; t.cashTotal += l.net; }
    if (l.warnings.length) t.warnings++;
    t.pendingOtDays += l.ot.pendingDays;
  }
  for (const k of Object.keys(t) as (keyof RunTotals)[]) if (!/Khr$|Count$|^employees$|^warnings$|^pendingOtDays$/.test(k)) t[k] = round2(t[k]);
  return t;
}

/**
 * Monthly payroll: works out every employee's pay from salary, attendance, approved overtime, allowances, one-off items
 * and advances, then Cambodian Tax on Salary and NSSF. A month is a "run": draft (recalculate freely) -> approved (locked)
 * -> paid. Locked runs keep the numbers they were approved with; only a company admin can unlock.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ctx: CompanyContextService,
    private readonly summaries: AttendanceSummaryService,
    private readonly overtime: OvertimeService,
    private readonly telegram: TelegramService,
  ) {}

  // ---- settings ----

  async getSettings(companyId: string): Promise<PayrollSettings> {
    const [row, ot] = await Promise.all([
      this.db.maybeOne('SELECT * FROM payroll_settings WHERE company_id = $1', [companyId]),
      this.overtime.getPolicy(companyId),
    ]);
    return rowToSettings(row, ot.currency);
  }

  async updateSettings(companyId: string, input: Partial<PayrollSettings>, actor: AuthUser, ip: string): Promise<PayrollSettings> {
    const before = await this.getSettings(companyId);
    const n: PayrollSettings = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as PayrollSettings;
    const brackets = [...n.taxBrackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    if (!brackets.length || brackets[brackets.length - 1].upTo !== null) throw badRequest('The last tax bracket must have no upper limit.', 'BAD_BRACKETS');
    if (brackets.filter((b) => b.upTo === null).length > 1) throw badRequest('Only the last tax bracket can be without an upper limit.', 'BAD_BRACKETS');
    if (n.nssfMinWage > n.nssfMaxWage) throw badRequest('The NSSF minimum wage must be below the maximum.', 'BAD_NSSF');
    await this.db.query(
      `INSERT INTO payroll_settings (company_id, base_from_attendance, days_basis, fixed_days, unpaid_leave_types, late_deduction, late_mode, late_value, late_free,
          include_early_leave, overtime, allowances, deductions, tax, nssf, exchange_rate, tax_brackets, dependent_allowance, non_resident_rate, fringe_rate,
          pension_deductible, nssf_pension_employee, nssf_pension_employer, nssf_health_employer, nssf_risk_employer, nssf_min_wage, nssf_max_wage, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, now())
       ON CONFLICT (company_id) DO UPDATE SET base_from_attendance = $2, days_basis = $3, fixed_days = $4, unpaid_leave_types = $5, late_deduction = $6,
          late_mode = $7, late_value = $8, late_free = $9, include_early_leave = $10, overtime = $11, allowances = $12, deductions = $13, tax = $14, nssf = $15,
          exchange_rate = $16, tax_brackets = $17, dependent_allowance = $18, non_resident_rate = $19, fringe_rate = $20, pension_deductible = $21,
          nssf_pension_employee = $22, nssf_pension_employer = $23, nssf_health_employer = $24, nssf_risk_employer = $25, nssf_min_wage = $26,
          nssf_max_wage = $27, updated_at = now()`,
      [companyId, n.baseFromAttendance, n.daysBasis, n.fixedDays, n.unpaidLeaveTypes, n.lateDeduction, n.lateMode, n.lateValue, n.lateFree, n.includeEarlyLeave,
        n.overtime, n.allowances, n.deductions, n.tax, n.nssf, n.exchangeRate, JSON.stringify(brackets), n.dependentAllowance, n.nonResidentRate, n.fringeRate,
        n.pensionDeductible, n.nssfPensionEmployee, n.nssfPensionEmployer, n.nssfHealthEmployer, n.nssfRiskEmployer, n.nssfMinWage, n.nssfMaxWage],
    );
    if (input.currency && input.currency !== before.currency) {
      await this.overtime.updatePolicy(companyId, { currency: input.currency }, actor, ip);
    }
    const d = diff(before as any, { ...n, taxBrackets: brackets } as any);
    await this.audit.log({ companyId, userId: actor.id, action: 'update', module: 'payroll_settings', recordId: companyId, oldValue: d.old, newValue: d.new, ip });
    return this.getSettings(companyId);
  }

  // ---- calculation ----

  /** Pay lines for a month. `runId` = the run being (re)calculated, so its own advance repayments are not counted twice. */
  async computeLines(companyId: string, month: string, rules: PayrollRules, exchangeRate: number, runId: string | null, employeeId?: string): Promise<PayLine[]> {
    const { from, to, start } = monthBounds(month);
    const [built, ot] = await Promise.all([
      this.summaries.build(companyId, from, to, null, employeeId ? { employeeIds: [employeeId] } : {}),
      this.overtime.compute(companyId, from, to, null, employeeId ? { employeeId } : {}),
    ]);
    const ids = built.employees.map((e) => e.id);
    if (!ids.length) return [];
    const [emps, allowances, items, advances] = await Promise.all([
      this.db.query(
        `SELECT id, monthly_salary, dependents, tax_resident, nssf_enrolled, bank_name, bank_account, bank_account_name
           FROM employees WHERE id = ANY($1::uuid[])`,
        [ids],
      ),
      this.db.query('SELECT * FROM employee_allowances WHERE employee_id = ANY($1::uuid[]) ORDER BY created_at', [ids]),
      this.db.query('SELECT * FROM payroll_items WHERE company_id = $1 AND month = $2 AND employee_id = ANY($3::uuid[]) ORDER BY created_at', [companyId, start, ids]),
      this.db.query(
        `SELECT a.*, COALESCE((SELECT sum(r.amount) FROM salary_advance_repayments r WHERE r.advance_id = a.id AND r.run_id IS DISTINCT FROM $3::uuid), 0) AS repaid
           FROM salary_advances a
          WHERE a.company_id = $1 AND a.status = 'active' AND a.start_month <= $2 AND a.employee_id = ANY($4::uuid[])
          ORDER BY a.issued_on, a.created_at`,
        [companyId, start, runId, ids],
      ),
    ]);
    const empBy = new Map(emps.map((r) => [r.id, r]));
    const group = <T extends { employee_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), r]);
      return m;
    };
    const allowBy = group(allowances);
    const itemBy = group(items);
    const advBy = group(advances);
    const otBy = new Map(ot.employees.map((x) => [x.employee.id, x]));
    const dates = dateRange(from, to);

    const lines: PayLine[] = [];
    for (const e of built.employees) {
      const days = built.days.get(e.id) ?? [];
      if (!days.length) continue;
      const er = empBy.get(e.id);
      const schedule = (e.scheduleId && built.schedules.get(e.scheduleId)) || built.schedules.get('') || null;
      const isWorkDay = (d: string) => !!schedule && schedule.workDays.includes(isoWeekday(d));
      const byDate = new Map(days.map((d) => [d.date, d]));
      const scheduled = dates.filter(isWorkDay).length;
      const notEmployed = dates.filter((d) => !byDate.has(d) && isWorkDay(d)).length;
      const absent = days.filter((d) => d.status === 'absent').length;
      const leaveDays = days.filter((d) => d.status === 'leave');
      const unpaidLeave = leaveDays.filter((d) => rules.unpaidLeaveTypes.includes(d.leaveType ?? '')).length;
      const o = otBy.get(e.id);
      const pendingDays = o ? o.days.filter((d) => d.status === 'pending').length : 0;

      const earnings: PayItem[] = [
        ...(allowBy.get(e.id) ?? []).map((a) => ({ name: a.name, amount: Number(a.amount), tax: a.tax_treatment as TaxTreatment })),
        ...(itemBy.get(e.id) ?? []).filter((i) => i.kind === 'earning').map((i) => ({ id: i.id, name: i.name, amount: Number(i.amount), tax: i.tax_treatment as TaxTreatment })),
      ];
      const deductions: PayItem[] = (itemBy.get(e.id) ?? []).filter((i) => i.kind === 'deduction').map((i) => ({ id: i.id, name: i.name, amount: Number(i.amount) }));
      const advanceItems: PayItem[] = [];
      for (const a of advBy.get(e.id) ?? []) {
        const balance = round2(Number(a.amount) - Number(a.repaid));
        const due = round2(Math.min(Number(a.installment), balance));
        if (due > 0) advanceItems.push({ id: a.id, name: `Salary advance of ${a.issued_on}`, amount: due, balance: round2(balance - due) });
      }

      const pay = computePay(
        {
          salary: er?.monthly_salary ?? null,
          hourlyRate: o?.hourlyRate ?? null,
          basisDays: rules.daysBasis === 'fixed' ? rules.fixedDays : scheduled || rules.fixedDays,
          unpaidDays: absent + unpaidLeave + notEmployed,
          lateMinutes: days.reduce((s, d) => s + d.lateMinutes, 0),
          earlyMinutes: days.reduce((s, d) => s + d.earlyMinutes, 0),
          lateTimes: days.filter((d) => d.lateMinutes > 0).length,
          earlyTimes: days.filter((d) => d.earlyMinutes > 0).length,
          otPay: o ? o.totals.amount ?? 0 : 0,
          earnings,
          deductions,
          advances: advanceItems,
          dependents: er?.dependents ?? 0,
          resident: er?.tax_resident ?? true,
          nssfEnrolled: er?.nssf_enrolled ?? true,
        },
        rules,
        exchangeRate,
      );
      if (rules.overtime && o?.totals.missingRate) pay.warnings.push('Some overtime not priced: no salary or hourly rate');
      if (rules.overtime && pendingDays) pay.warnings.push(`${pendingDays} overtime day${pendingDays > 1 ? 's' : ''} waiting for approval (not paid)`);

      lines.push({
        ...pay,
        employeeId: e.id, employeeCode: e.employeeCode, name: e.name, department: e.department, position: e.position, branch: e.branch,
        bank: er?.bank_account ? { name: er.bank_name, account: er.bank_account, accountName: er.bank_account_name } : null,
        dependents: er?.dependents ?? 0, nssfEnrolled: er?.nssf_enrolled ?? true, hourlyRate: o?.hourlyRate == null ? null : round2(o.hourlyRate),
        days: {
          basis: rules.daysBasis === 'fixed' ? rules.fixedDays : scheduled || rules.fixedDays, scheduled,
          worked: days.filter((d) => d.status === 'present' || d.status === 'late').length,
          paidLeave: leaveDays.length - unpaidLeave, unpaidLeave, absent, notEmployed,
          holidays: days.filter((d) => d.holiday && isWorkDay(d.date)).length,
          upcoming: days.filter((d) => d.status === 'upcoming' || d.status === 'not_yet').length,
        },
        late: { minutes: days.reduce((s, d) => s + d.lateMinutes, 0), earlyMinutes: days.reduce((s, d) => s + d.earlyMinutes, 0), times: days.filter((d) => d.lateMinutes > 0).length, earlyTimes: days.filter((d) => d.earlyMinutes > 0).length },
        ot: {
          workDayHours: o?.totals.workDayHours ?? 0, dayOffHours: o?.totals.dayOffHours ?? 0, holidayHours: o?.totals.holidayHours ?? 0,
          weightedHours: o?.totals.weightedHours ?? 0, pendingDays,
        },
      });
    }
    return lines;
  }

  private async runRow(companyId: string, month: string, tx: Queryable = this.db) {
    return tx.maybeOne(
      `SELECT r.*, to_char(r.month, 'YYYY-MM') AS month_key, ca.name AS calculated_by_name, ap.name AS approved_by_name, pa.name AS paid_by_name
         FROM payroll_runs r
         LEFT JOIN users ca ON ca.id = r.calculated_by LEFT JOIN users ap ON ap.id = r.approved_by LEFT JOIN users pa ON pa.id = r.paid_by
        WHERE r.company_id = $1 AND r.month = $2`,
      [companyId, monthBounds(month).start],
    );
  }

  private mapRun(r: any) {
    return {
      id: r.id, month: r.month_key, status: r.status as RunStatus, currency: r.currency, exchangeRate: Number(r.exchange_rate), totals: r.totals as RunTotals,
      rules: r.rules as PayrollRules, note: r.note, calculatedAt: r.calculated_at, calculatedBy: r.calculated_by_name ?? null, approvedAt: r.approved_at,
      approvedBy: r.approved_by_name ?? null, paidAt: r.paid_at, paidBy: r.paid_by_name ?? null,
    };
  }

  async listRuns(companyId: string) {
    const rows = await this.db.query(
      `SELECT r.*, to_char(r.month, 'YYYY-MM') AS month_key, ca.name AS calculated_by_name, ap.name AS approved_by_name, pa.name AS paid_by_name
         FROM payroll_runs r
         LEFT JOIN users ca ON ca.id = r.calculated_by LEFT JOIN users ap ON ap.id = r.approved_by LEFT JOIN users pa ON pa.id = r.paid_by
        WHERE r.company_id = $1 ORDER BY r.month DESC LIMIT 60`,
      [companyId],
    );
    return rows.map((r) => this.mapRun(r));
  }

  async getRun(companyId: string, month: string) {
    const r = await this.runRow(companyId, month);
    if (!r) throw notFound('Payroll for that month');
    const lines = await this.db.query(`SELECT data FROM payroll_lines WHERE run_id = $1`, [r.id]);
    const list = lines.map((l) => l.data as PayLine).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }));
    return { run: this.mapRun(r), lines: list };
  }

  /** Creates the month's draft or recalculates it. Locked months cannot be recalculated. */
  async calculate(user: AuthUser, month: string, exchangeRate: number | undefined, ip: string) {
    const companyId = user.companyId!;
    const settings = await this.getSettings(companyId);
    const existing = await this.runRow(companyId, month);
    if (existing && existing.status !== 'draft') throw badRequest(`Payroll for ${month} is ${existing.status} and locked. A company admin must unlock it first.`, 'PAYROLL_LOCKED');
    const rate = settings.currency === 'KHR' ? 1 : exchangeRate ?? (existing ? Number(existing.exchange_rate) : settings.exchangeRate);
    const { exchangeRate: _, ...rules } = settings;
    const lines = await this.computeLines(companyId, month, rules, rate, existing?.id ?? null);
    const totals = totalsOf(lines);
    await this.db.tx(async (tx) => {
      const run = await tx.maybeOne(
        `INSERT INTO payroll_runs (company_id, month, currency, exchange_rate, rules, totals, calculated_at, calculated_by)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
         ON CONFLICT (company_id, month) DO UPDATE SET currency = $3, exchange_rate = $4, rules = $5, totals = $6, calculated_at = now(), calculated_by = $7
           WHERE payroll_runs.status = 'draft'
         RETURNING id`,
        [companyId, monthBounds(month).start, settings.currency, rate, JSON.stringify(rules), JSON.stringify(totals), user.id],
      );
      if (!run) throw badRequest(`Payroll for ${month} was locked meanwhile.`, 'PAYROLL_LOCKED');
      await tx.query('DELETE FROM payroll_lines WHERE run_id = $1', [run.id]);
      await this.insertLines(tx, run.id, companyId, lines);
    });
    await this.audit.log({
      companyId, userId: user.id, action: existing ? 'recalculate' : 'create', module: 'payroll', recordId: month,
      newValue: { exchangeRate: rate, employees: totals.employees, gross: totals.gross, net: totals.net }, ip,
    });
    return this.getRun(companyId, month);
  }

  private async insertLines(tx: Queryable, runId: string, companyId: string, lines: PayLine[]) {
    for (let i = 0; i < lines.length; i += 200) {
      const chunk = lines.slice(i, i + 200);
      await tx.query(
        `INSERT INTO payroll_lines (run_id, company_id, employee_id, gross, net, data)
         SELECT $1, $2, x.employee_id, x.gross, x.net, x.data FROM jsonb_to_recordset($3::jsonb) AS x(employee_id uuid, gross numeric, net numeric, data jsonb)
         ON CONFLICT (run_id, employee_id) DO UPDATE SET gross = EXCLUDED.gross, net = EXCLUDED.net, data = EXCLUDED.data`,
        [runId, companyId, JSON.stringify(chunk.map((l) => ({ employee_id: l.employeeId, gross: l.gross, net: l.net, data: l })))],
      );
    }
  }

  /** After a pay item, allowance or advance changes: refresh that employee's line in every draft month it touches. */
  private async refreshEmployee(companyId: string, employeeId: string, month?: string) {
    const runs = await this.db.query(
      `SELECT id, to_char(month, 'YYYY-MM') AS month_key, exchange_rate, rules FROM payroll_runs
        WHERE company_id = $1 AND status = 'draft' AND ($2::date IS NULL OR month = $2)`,
      [companyId, month ? monthBounds(month).start : null],
    );
    for (const r of runs) {
      const settings = await this.getSettings(companyId);
      const { exchangeRate: _, ...rules } = settings;
      const rate = settings.currency === 'KHR' ? 1 : Number(r.exchange_rate);
      const lines = await this.computeLines(companyId, r.month_key, rules, rate, r.id, employeeId);
      await this.db.tx(async (tx) => {
        const locked = await tx.maybeOne(`SELECT status FROM payroll_runs WHERE id = $1 FOR UPDATE`, [r.id]);
        if (locked?.status !== 'draft') return;
        await tx.query('DELETE FROM payroll_lines WHERE run_id = $1 AND employee_id = $2', [r.id, employeeId]);
        await this.insertLines(tx, r.id, companyId, lines);
        const all = await tx.query('SELECT data FROM payroll_lines WHERE run_id = $1', [r.id]);
        await tx.query('UPDATE payroll_runs SET totals = $2, rules = $3 WHERE id = $1', [r.id, JSON.stringify(totalsOf(all.map((x) => x.data))), JSON.stringify(rules)]);
      });
    }
  }

  /** Recalculates with the latest attendance, then locks the month. */
  async approve(user: AuthUser, month: string, ip: string) {
    const companyId = user.companyId!;
    const current = await this.runRow(companyId, month);
    if (!current) throw notFound('Payroll for that month');
    if (current.status !== 'draft') throw badRequest(`Payroll for ${month} is already ${current.status}.`, 'ALREADY_LOCKED');
    const { lines } = await this.calculate(user, month, undefined, ip);
    if (!lines.length) throw badRequest('There is nobody to pay this month.', 'EMPTY_PAYROLL');
    await this.db.tx(async (tx) => {
      const r = await tx.maybeOne(`SELECT id, status FROM payroll_runs WHERE company_id = $1 AND month = $2 FOR UPDATE`, [companyId, monthBounds(month).start]);
      if (r?.status !== 'draft') throw badRequest(`Payroll for ${month} is already locked.`, 'ALREADY_LOCKED');
      await tx.query(`UPDATE payroll_runs SET status = 'approved', approved_at = now(), approved_by = $2 WHERE id = $1`, [r.id, user.id]);
      const repayments = lines.flatMap((l) => l.advances.filter((a) => a.id).map((a) => ({ advance_id: a.id, amount: a.amount })));
      if (repayments.length) {
        await tx.query(
          `INSERT INTO salary_advance_repayments (advance_id, run_id, amount)
           SELECT x.advance_id, $1, x.amount FROM jsonb_to_recordset($2::jsonb) AS x(advance_id uuid, amount numeric)`,
          [r.id, JSON.stringify(repayments)],
        );
      }
    });
    await this.audit.log({ companyId, userId: user.id, action: 'approve', module: 'payroll', recordId: month, newValue: { status: 'approved' }, ip });
    const out = await this.getRun(companyId, month);
    for (const l of out.lines) this.telegram.notifyEmployee(l.employeeId, tgMessages.payslip(month, l.net, out.run.currency), [tgMessages.payslipButton(month)]);
    return out;
  }

  async markPaid(user: AuthUser, month: string, ip: string) {
    const companyId = user.companyId!;
    const r = await this.db.maybeOne(
      `UPDATE payroll_runs SET status = 'paid', paid_at = now(), paid_by = $3 WHERE company_id = $1 AND month = $2 AND status = 'approved' RETURNING id`,
      [companyId, monthBounds(month).start, user.id],
    );
    if (!r) throw badRequest('Only an approved payroll can be marked as paid.', 'NOT_APPROVED');
    await this.audit.log({ companyId, userId: user.id, action: 'paid', module: 'payroll', recordId: month, newValue: { status: 'paid' }, ip });
    return this.getRun(companyId, month);
  }

  /** Back to draft so it can be adjusted and recalculated. Advance repayments of the month are undone. */
  async unlock(user: AuthUser, month: string, reason: string, ip: string) {
    const companyId = user.companyId!;
    const before = await this.db.tx(async (tx) => {
      const r = await tx.maybeOne(`SELECT id, status FROM payroll_runs WHERE company_id = $1 AND month = $2 FOR UPDATE`, [companyId, monthBounds(month).start]);
      if (!r) throw notFound('Payroll for that month');
      if (r.status === 'draft') throw badRequest('This payroll is not locked.', 'NOT_LOCKED');
      await tx.query(`UPDATE payroll_runs SET status = 'draft', approved_at = NULL, approved_by = NULL, paid_at = NULL, paid_by = NULL, note = $2 WHERE id = $1`, [r.id, reason.trim()]);
      await tx.query('DELETE FROM salary_advance_repayments WHERE run_id = $1', [r.id]);
      return r.status;
    });
    await this.audit.log({ companyId, userId: user.id, action: 'unlock', module: 'payroll', recordId: month, oldValue: { status: before }, newValue: { status: 'draft', reason }, ip });
    return this.getRun(companyId, month);
  }

  async deleteRun(user: AuthUser, month: string, ip: string) {
    const companyId = user.companyId!;
    const r = await this.db.maybeOne(`DELETE FROM payroll_runs WHERE company_id = $1 AND month = $2 AND status = 'draft' RETURNING id`, [companyId, monthBounds(month).start]);
    if (!r) throw badRequest('Only a draft payroll can be deleted.', 'NOT_DRAFT');
    await this.audit.log({ companyId, userId: user.id, action: 'delete', module: 'payroll', recordId: month, ip });
    return { ok: true };
  }

  // ---- one-off items ----

  private async checkEmployee(companyId: string, employeeId: string) {
    const e = await this.db.maybeOne('SELECT id, name FROM employees WHERE company_id = $1 AND id = $2', [companyId, employeeId]);
    if (!e) throw notFound('Employee');
    return e;
  }

  async listItems(companyId: string, month: string, employeeId?: string) {
    const rows = await this.db.query(
      `SELECT i.*, e.employee_code, e.name AS employee_name, u.name AS created_by_name FROM payroll_items i
         JOIN employees e ON e.id = i.employee_id LEFT JOIN users u ON u.id = i.created_by
        WHERE i.company_id = $1 AND i.month = $2 AND ($3::uuid IS NULL OR i.employee_id = $3)
        ORDER BY e.employee_code, i.created_at`,
      [companyId, monthBounds(month).start, employeeId ?? null],
    );
    return rows.map((r) => ({
      id: r.id, employeeId: r.employee_id, employeeCode: r.employee_code, employeeName: r.employee_name, month, kind: r.kind, name: r.name,
      amount: Number(r.amount), tax: r.tax_treatment, createdBy: r.created_by_name, createdAt: r.created_at,
    }));
  }

  async addItem(user: AuthUser, input: ItemInput, ip: string) {
    const companyId = user.companyId!;
    const { start } = monthBounds(input.month);
    await this.ctx.assertPayrollOpen(companyId, [start]);
    await this.checkEmployee(companyId, input.employeeId);
    const r = await this.db.one(
      `INSERT INTO payroll_items (company_id, employee_id, month, kind, name, amount, tax_treatment, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [companyId, input.employeeId, start, input.kind, input.name.trim(), input.amount, input.kind === 'earning' ? input.tax ?? 'salary' : 'salary', user.id],
    );
    await this.audit.log({ companyId, userId: user.id, action: 'create', module: 'payroll_items', recordId: r.id, newValue: input, ip });
    await this.refreshEmployee(companyId, input.employeeId, input.month);
    return { id: r.id };
  }

  async deleteItem(user: AuthUser, id: string, ip: string) {
    const companyId = user.companyId!;
    const r = await this.db.maybeOne(`SELECT *, to_char(month, 'YYYY-MM') AS month_key FROM payroll_items WHERE company_id = $1 AND id = $2`, [companyId, id]);
    if (!r) throw notFound('Pay item');
    await this.ctx.assertPayrollOpen(companyId, [r.month]);
    await this.db.query('DELETE FROM payroll_items WHERE id = $1', [id]);
    await this.audit.log({ companyId, userId: user.id, action: 'delete', module: 'payroll_items', recordId: id, oldValue: { name: r.name, amount: r.amount, kind: r.kind }, ip });
    await this.refreshEmployee(companyId, r.employee_id, r.month_key);
    return { ok: true };
  }

  // ---- monthly allowances ----

  async listAllowances(companyId: string, employeeId: string) {
    await this.checkEmployee(companyId, employeeId);
    const rows = await this.db.query('SELECT * FROM employee_allowances WHERE company_id = $1 AND employee_id = $2 ORDER BY created_at', [companyId, employeeId]);
    return rows.map((r) => ({ id: r.id, name: r.name, amount: Number(r.amount), tax: r.tax_treatment }));
  }

  async addAllowance(user: AuthUser, employeeId: string, input: { name: string; amount: number; tax?: TaxTreatment }, ip: string) {
    const companyId = user.companyId!;
    await this.checkEmployee(companyId, employeeId);
    const r = await this.db.one(
      `INSERT INTO employee_allowances (company_id, employee_id, name, amount, tax_treatment) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [companyId, employeeId, input.name.trim(), input.amount, input.tax ?? 'salary'],
    );
    await this.audit.log({ companyId, userId: user.id, action: 'create', module: 'allowances', recordId: r.id, newValue: { employeeId, ...input }, ip });
    await this.refreshEmployee(companyId, employeeId);
    return this.listAllowances(companyId, employeeId);
  }

  async deleteAllowance(user: AuthUser, id: string, ip: string) {
    const companyId = user.companyId!;
    const r = await this.db.maybeOne('DELETE FROM employee_allowances WHERE company_id = $1 AND id = $2 RETURNING *', [companyId, id]);
    if (!r) throw notFound('Allowance');
    await this.audit.log({ companyId, userId: user.id, action: 'delete', module: 'allowances', recordId: id, oldValue: { name: r.name, amount: r.amount }, ip });
    await this.refreshEmployee(companyId, r.employee_id);
    return this.listAllowances(companyId, r.employee_id);
  }

  // ---- salary advances ----

  async listAdvances(companyId: string, q: { employeeId?: string; status?: string }) {
    const rows = await this.db.query(
      `SELECT a.*, to_char(a.start_month, 'YYYY-MM') AS start_key, e.employee_code, e.name AS employee_name, u.name AS created_by_name,
              COALESCE((SELECT sum(r.amount) FROM salary_advance_repayments r WHERE r.advance_id = a.id), 0) AS repaid,
              (SELECT count(*) FROM salary_advance_repayments r WHERE r.advance_id = a.id)::int AS payments
         FROM salary_advances a JOIN employees e ON e.id = a.employee_id LEFT JOIN users u ON u.id = a.created_by
        WHERE a.company_id = $1 AND ($2::uuid IS NULL OR a.employee_id = $2)
        ORDER BY (a.status = 'active') DESC, a.issued_on DESC, a.created_at DESC`,
      [companyId, q.employeeId ?? null],
    );
    const list = rows.map((r) => {
      const balance = round2(Number(r.amount) - Number(r.repaid));
      const status = r.status === 'cancelled' ? 'cancelled' : balance <= 0 ? 'repaid' : 'active';
      return {
        id: r.id, employeeId: r.employee_id, employeeCode: r.employee_code, employeeName: r.employee_name, amount: Number(r.amount), installment: Number(r.installment),
        startMonth: r.start_key, issuedOn: r.issued_on, note: r.note, repaid: Number(r.repaid), payments: r.payments, balance, status, createdBy: r.created_by_name,
      };
    });
    return q.status && q.status !== 'all' ? list.filter((a) => a.status === q.status) : list;
  }

  async addAdvance(user: AuthUser, input: AdvanceInput, ip: string) {
    const companyId = user.companyId!;
    await this.checkEmployee(companyId, input.employeeId);
    if (input.installment > input.amount) throw badRequest('The monthly repayment cannot be more than the advance.', 'BAD_INSTALLMENT');
    const r = await this.db.one(
      `INSERT INTO salary_advances (company_id, employee_id, amount, installment, start_month, issued_on, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [companyId, input.employeeId, input.amount, input.installment, monthBounds(input.startMonth).start, input.issuedOn, input.note?.trim() || null, user.id],
    );
    await this.audit.log({ companyId, userId: user.id, action: 'create', module: 'salary_advances', recordId: r.id, newValue: input, ip });
    await this.refreshEmployee(companyId, input.employeeId);
    return { id: r.id };
  }

  /** Stops future repayments; repayments in locked months stay. */
  async cancelAdvance(user: AuthUser, id: string, ip: string) {
    const companyId = user.companyId!;
    const r = await this.db.maybeOne(`UPDATE salary_advances SET status = 'cancelled' WHERE company_id = $1 AND id = $2 AND status = 'active' RETURNING employee_id`, [companyId, id]);
    if (!r) throw badRequest('That advance is not active.', 'NOT_ACTIVE');
    await this.audit.log({ companyId, userId: user.id, action: 'cancel', module: 'salary_advances', recordId: id, ip });
    await this.refreshEmployee(companyId, r.employee_id);
    return { ok: true };
  }

  // ---- employee self-service ----

  /** Approved / paid months only: drafts can still change. */
  async myPayslips(user: AuthUser) {
    const employeeId = requireEmployee(user);
    const rows = await this.db.query(
      `SELECT to_char(r.month, 'YYYY-MM') AS month, r.status, r.currency, r.paid_at, l.gross, l.net
         FROM payroll_lines l JOIN payroll_runs r ON r.id = l.run_id
        WHERE l.employee_id = $1 AND r.company_id = $2 AND r.status IN ('approved', 'paid')
        ORDER BY r.month DESC LIMIT 36`,
      [employeeId, user.companyId],
    );
    return rows.map((r) => ({ month: r.month, status: r.status, currency: r.currency, paidAt: r.paid_at, gross: Number(r.gross), net: Number(r.net) }));
  }

  async payslip(companyId: string, month: string, employeeId: string, lockedOnly: boolean) {
    const r = await this.runRow(companyId, month);
    if (!r || (lockedOnly && r.status === 'draft')) throw notFound('Payslip');
    const l = await this.db.maybeOne('SELECT data FROM payroll_lines WHERE run_id = $1 AND employee_id = $2', [r.id, employeeId]);
    if (!l) throw notFound('Payslip');
    return { run: this.mapRun(r), line: l.data as PayLine };
  }
}
