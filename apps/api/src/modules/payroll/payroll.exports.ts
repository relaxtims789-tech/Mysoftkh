import PDFDocument from 'pdfkit';
import type { Report } from '../reports/reports.service';
import type { PayLine, RunTotals } from './payroll.service';

interface RunInfo {
  month: string;
  status: string;
  currency: string;
  exchangeRate: number;
  totals: RunTotals;
  approvedAt: string | null;
  approvedBy: string | null;
  paidAt: string | null;
}

export function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const money = (n: number, currency: string) =>
  currency === 'KHR' ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const riel = (n: number) => Math.round(n).toLocaleString('en-US');

/** One row per employee with every pay item, for accounting. */
export function summaryReport(run: RunInfo, lines: PayLine[], companyName: string): Report {
  const c = run.currency;
  const rows = lines.map((l) => ({
    employeeCode: l.employeeCode, name: l.name, department: l.department, salary: l.salary, unpaidDays: l.unpaidDays || '', absence: l.absenceDeduction || '',
    late: l.lateDeduction || '', ot: l.otPay || '', earnings: l.earningsTotal || '', gross: l.gross, nssf: l.nssf.employee || '', tax: l.tax.tax || '',
    taxKhr: l.tax.taxKhr || '', deductions: l.deductionsTotal || '', advances: l.advancesTotal || '', net: l.net, netKhr: c === 'KHR' ? '' : l.netKhr,
    nssfEmployer: l.nssf.employer || '', fringe: l.fringe.tax || '', bank: l.bank ? `${l.bank.name ?? ''} ${l.bank.account}`.trim() : 'Cash',
  }));
  const t = run.totals;
  return {
    type: 'monthly' as any,
    title: `Payroll ${monthName(run.month)}`,
    subtitle: `${run.month} · ${run.status}${c === 'USD' ? ` · 1 USD = ${riel(run.exchangeRate)} KHR` : ''} · ${lines.length} employees`,
    companyName,
    generatedAt: new Date().toISOString(),
    columns: [
      { key: 'employeeCode', label: 'Employee ID', width: 10 },
      { key: 'name', label: 'Name', width: 20 },
      { key: 'department', label: 'Department', width: 14 },
      { key: 'salary', label: `Salary (${c})`, width: 10, align: 'right' },
      { key: 'unpaidDays', label: 'Unpaid days', width: 7, align: 'right' },
      { key: 'absence', label: 'Absence ded.', width: 9, align: 'right' },
      { key: 'late', label: 'Late ded.', width: 8, align: 'right' },
      { key: 'ot', label: 'Overtime', width: 9, align: 'right' },
      { key: 'earnings', label: 'Allowances & bonus', width: 10, align: 'right' },
      { key: 'gross', label: 'Gross', width: 10, align: 'right' },
      { key: 'nssf', label: 'NSSF (staff)', width: 9, align: 'right' },
      { key: 'tax', label: 'Tax on salary', width: 9, align: 'right' },
      { key: 'taxKhr', label: 'Tax (KHR)', width: 10, align: 'right' },
      { key: 'deductions', label: 'Deductions', width: 9, align: 'right' },
      { key: 'advances', label: 'Advances', width: 9, align: 'right' },
      { key: 'net', label: `Net pay (${c})`, width: 10, align: 'right' },
      ...(c === 'KHR' ? [] : [{ key: 'netKhr', label: 'Net (KHR)', width: 11, align: 'right' as const }]),
      { key: 'nssfEmployer', label: 'NSSF (employer)', width: 9, align: 'right' },
      { key: 'fringe', label: 'Fringe tax', width: 8, align: 'right' },
      { key: 'bank', label: 'Bank account', width: 16 },
    ],
    rows,
    totals: {
      salary: t.salary, absence: t.absenceDeduction, late: t.lateDeduction, ot: t.otPay, earnings: t.earnings, gross: t.gross, nssf: t.nssfEmployee, tax: t.tax,
      taxKhr: t.taxKhr, deductions: t.deductions, advances: t.advances, net: t.net, netKhr: c === 'KHR' ? '' : t.netKhr, nssfEmployer: t.nssfEmployer, fringe: t.fringeTax,
    },
  };
}

/** Net pay per bank account, to upload to or hand to the bank. Cash payments are listed after the transfers. */
export function bankReport(run: RunInfo, lines: PayLine[], companyName: string): Report {
  const paid = lines.filter((l) => l.net > 0).sort((a, b) => Number(!a.bank) - Number(!b.bank) || (a.bank?.name ?? '').localeCompare(b.bank?.name ?? '') || a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }));
  return {
    type: 'monthly' as any,
    title: `Salary transfers ${monthName(run.month)}`,
    subtitle: `${run.month} · ${run.totals.bankCount} bank transfers ${money(run.totals.bankTotal, run.currency)} ${run.currency} · ${run.totals.cashCount} cash ${money(run.totals.cashTotal, run.currency)} ${run.currency}`,
    companyName,
    generatedAt: new Date().toISOString(),
    columns: [
      { key: 'no', label: 'No.', width: 5, align: 'right' },
      { key: 'employeeCode', label: 'Employee ID', width: 11 },
      { key: 'name', label: 'Employee name', width: 22 },
      { key: 'method', label: 'Method', width: 7 },
      { key: 'bank', label: 'Bank', width: 14 },
      { key: 'account', label: 'Account number', width: 18 },
      { key: 'accountName', label: 'Account name', width: 20 },
      { key: 'amount', label: 'Amount', width: 11, align: 'right' },
      { key: 'currency', label: 'Currency', width: 7 },
      { key: 'description', label: 'Description', width: 16 },
    ],
    rows: paid.map((l, i) => ({
      no: i + 1, employeeCode: l.employeeCode, name: l.name, method: l.bank ? 'Bank' : 'Cash', bank: l.bank?.name ?? '', account: l.bank?.account ?? '',
      accountName: l.bank?.accountName ?? (l.bank ? l.name : ''), amount: l.net, currency: run.currency, description: `Salary ${run.month}`,
    })),
    totals: { amount: paid.reduce((s, l) => Math.round((s + l.net) * 100) / 100, 0) },
  };
}

/** The standard PDF fonts only cover Latin-1. */
const latin = (s: string | null | undefined) => (s ?? '').replace(/[^\x20-\xFF]/g, '?');

/** One payslip per page (A5). */
export function payslipsPdf(run: RunInfo, lines: PayLine[], companyName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 30, autoFirstPage: false, info: { Title: `Payslips ${run.month}`, Author: companyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const c = run.currency;
    const m = (n: number) => money(n, c);

    for (const l of lines) {
      doc.addPage();
      const left = 30;
      const width = doc.page.width - 60;
      const right = left + width;

      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(latin(companyName), left, 30, { width: width - 90 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#1F4E79').text('PAYSLIP', right - 90, 30, { width: 90, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(monthName(run.month), right - 140, 47, { width: 140, align: 'right' });
      let y = Math.max(doc.y, 64) + 6;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor('#1F4E79').stroke();
      y += 8;

      const kv = (label: string, value: string, x: number, yy: number, w: number) => {
        doc.font('Helvetica').fontSize(7.5).fillColor('#777').text(label, x, yy, { width: w });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(latin(value) || '-', x, yy + 9, { width: w, lineBreak: false, ellipsis: true });
      };
      const col = width / 3;
      kv('Employee', l.name, left, y, col * 2 - 6);
      kv('Employee ID', l.employeeCode, left + col * 2, y, col);
      y += 26;
      kv('Department', l.department ?? '', left, y, col - 6);
      kv('Position', l.position ?? '', left + col, y, col - 6);
      kv('Paid to', l.bank ? `${l.bank.name ?? 'Bank'} ${l.bank.account}` : 'Cash', left + col * 2, y, col);
      y += 30;

      const d = l.days;
      doc.roundedRect(left, y, width, 30, 4).fill('#F2F5F9');
      const stats: [string, string][] = [
        ['Days worked', String(d.worked)], ['Paid leave', String(d.paidLeave)], ['Unpaid days', String(l.unpaidDays)],
        ['Late / early', `${l.late.minutes + l.late.earlyMinutes} min`], ['Overtime', `${(l.ot.workDayHours + l.ot.dayOffHours + l.ot.holidayHours).toFixed(2)} h`],
      ];
      stats.forEach(([k, v], i) => {
        const x = left + (width / stats.length) * i;
        doc.font('Helvetica').fontSize(7).fillColor('#777').text(k, x, y + 5, { width: width / stats.length, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(v, x, y + 15, { width: width / stats.length, align: 'center' });
      });
      y += 40;

      const table = (title: string, rows: [string, number][], total: [string, number]) => {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
        doc.rect(left, y, width, 15).fill('#1F4E79');
        doc.fillColor('#fff').text(title, left + 6, y + 4, { width: width - 100 });
        doc.text(c, right - 100, y + 4, { width: 94, align: 'right' });
        y += 17;
        doc.font('Helvetica').fontSize(8.5).fillColor('#111');
        for (const [k, v] of rows) {
          doc.fillColor(v < 0 ? '#B42318' : '#111').text(latin(k), left + 6, y, { width: width - 110, lineBreak: false, ellipsis: true });
          doc.text(m(v), right - 100, y, { width: 94, align: 'right' });
          y += 13;
        }
        doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor('#BBB').stroke();
        y += 3;
        doc.font('Helvetica-Bold').fillColor('#111').text(total[0], left + 6, y, { width: width - 110 });
        doc.text(m(total[1]), right - 100, y, { width: 94, align: 'right' });
        y += 18;
      };

      const earnings: [string, number][] = [[`Basic salary`, l.salary]];
      if (l.absenceDeduction) earnings.push([`Unpaid days (${l.unpaidDays} x ${m(l.dailyRate)})`, -l.absenceDeduction]);
      if (l.lateDeduction) earnings.push(['Late / early leave', -l.lateDeduction]);
      if (l.otPay) earnings.push(['Overtime', l.otPay]);
      for (const e of l.earnings) earnings.push([e.tax === 'exempt' ? `${e.name} (tax-free)` : e.name, e.amount]);
      table('EARNINGS', earnings, ['Gross pay', l.gross]);

      const deductions: [string, number][] = [];
      if (l.nssf.employee) deductions.push(['NSSF pension (employee)', l.nssf.employee]);
      if (l.tax.tax) deductions.push([`Tax on salary (${riel(l.tax.taxKhr)} KHR)`, l.tax.tax]);
      for (const x of l.deductions) deductions.push([x.name, x.amount]);
      for (const x of l.advances) deductions.push([`${x.name}${x.balance ? ` (left ${m(x.balance)})` : ''}`, x.amount]);
      if (!deductions.length) deductions.push(['None', 0]);
      table('DEDUCTIONS', deductions, ['Total deductions', l.totalDeductions]);

      doc.roundedRect(left, y, width, 34, 4).fill('#E8F0F8');
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1F4E79').text('NET PAY', left + 10, y + 11);
      doc.fontSize(14).text(`${m(l.net)} ${c}`, right - 190, y + 6, { width: 180, align: 'right' });
      if (c === 'USD') doc.font('Helvetica').fontSize(7.5).fillColor('#555').text(`= ${riel(l.netKhr)} KHR`, right - 190, y + 23, { width: 180, align: 'right' });
      y += 44;

      doc.font('Helvetica').fontSize(7).fillColor('#777');
      const notes = [
        c === 'USD' ? `Exchange rate for tax: 1 USD = ${riel(run.exchangeRate)} KHR.` : '',
        l.tax.dependentsKhr ? `Dependants: ${l.dependents} (${riel(l.tax.dependentsKhr)} KHR allowance).` : '',
        l.nssf.employer ? `Employer pays NSSF ${m(l.nssf.employer)} ${c} (pension, health care, occupational risk) on top of your pay.` : '',
        run.approvedAt ? `Approved ${new Date(run.approvedAt).toISOString().slice(0, 10)}${run.approvedBy ? ` by ${latin(run.approvedBy)}` : ''}.${run.paidAt ? ` Paid ${new Date(run.paidAt).toISOString().slice(0, 10)}.` : ''}` : 'DRAFT - not approved yet.',
      ].filter(Boolean).join(' ');
      doc.text(notes, left, y, { width });
      // Writing inside the bottom margin would start a new (blank) page.
      doc.page.margins.bottom = 0;
      doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, left, doc.page.height - 26, { width, align: 'right', lineBreak: false });
    }
    if (!lines.length) {
      doc.addPage();
      doc.font('Helvetica').fontSize(10).text('No payslips for this month.', 30, 40);
    }
    doc.end();
  });
}
