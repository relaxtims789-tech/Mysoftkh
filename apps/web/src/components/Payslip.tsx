import { ReactNode } from 'react';
import { t } from '../lib/i18n';
import { money, PayLine, riel } from '../lib/payroll';

function Row({ label, value, minus, strong, hint }: { label: ReactNode; value: number; minus?: boolean; strong?: boolean; hint?: ReactNode }) {
  return (
    <div className="row between" style={{ padding: '5px 0', fontWeight: strong ? 700 : undefined }}>
      <span>
        {label}
        {hint && <span className="faint small" style={{ display: 'block', fontWeight: 400 }}>{hint}</span>}
      </span>
      <span className="nowrap" style={{ fontVariantNumeric: 'tabular-nums', color: minus ? 'var(--bad)' : undefined }}>{minus && value ? '−' : ''}{money(value)}</span>
    </div>
  );
}

/** Earnings, deductions and net pay of one payslip (admin line details and the employee's phone). */
export function PayslipView({ line, currency, exchangeRate, showEmployer }: { line: PayLine; currency: string; exchangeRate: number; showEmployer?: boolean }) {
  const l = line;
  const otHours = l.ot.workDayHours + l.ot.dayOffHours + l.ot.holidayHours;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card" style={{ boxShadow: 'none' }}>
        <div className="stats4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div><div className="n">{l.days.worked}</div><div className="l">{t('Days worked')}</div></div>
          <div><div className="n">{l.days.paidLeave}</div><div className="l">{t('Paid leave')}</div></div>
          <div><div className="n" style={{ color: l.unpaidDays ? 'var(--bad)' : undefined }}>{l.unpaidDays}</div><div className="l">{t('Unpaid days')}</div></div>
          <div><div className="n">{otHours ? otHours.toFixed(1) : 0}</div><div className="l">{t('OT hours')}</div></div>
        </div>
      </div>

      <div>
        <div className="faint small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('Earnings ({currency})', { currency })}</div>
        <Row label={t('Basic salary')} value={l.salary} />
        {l.absenceDeduction > 0 && (
          <Row label={t('Unpaid days')} minus value={l.absenceDeduction}
            hint={`${l.unpaidDays} × ${money(l.dailyRate, currency)} (${[l.days.absent && t('{n} absent', { n: l.days.absent }), l.days.unpaidLeave && t('{n} unpaid leave', { n: l.days.unpaidLeave }), l.days.notEmployed && t('{n} before start / after leaving', { n: l.days.notEmployed })].filter(Boolean).join(', ')})`} />
        )}
        {l.lateDeduction > 0 && <Row label={t('Late / early leave')} minus value={l.lateDeduction} hint={t('{late} min late, {early} min early', { late: l.late.minutes, early: l.late.earlyMinutes })} />}
        {l.otPay > 0 && <Row label={t('Overtime')} value={l.otPay} hint={l.ot.weightedHours ? t('{h} h ({paid} paid hours)', { h: otHours.toFixed(2), paid: l.ot.weightedHours }) : t('{h} h', { h: otHours.toFixed(2) })} />}
        {l.earnings.map((e, i) => <Row key={i} label={e.name} value={e.amount} hint={e.tax === 'exempt' ? t('Tax-free') : e.tax === 'fringe' ? t('Fringe benefit') : undefined} />)}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 4 }} />
        <Row label={t('Gross pay')} value={l.gross} strong />
      </div>

      <div>
        <div className="faint small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('Deductions ({currency})', { currency })}</div>
        {l.nssf.employee > 0 && <Row label={t('NSSF pension')} value={l.nssf.employee} hint={t('{amount} on a wage of {wage}', { amount: riel(l.nssf.employeeKhr), wage: riel(l.nssf.wageKhr) })} />}
        {l.tax.tax > 0 && (
          <Row label={t('Tax on salary')} value={l.tax.tax}
            hint={l.tax.resident
              ? (l.tax.dependentsKhr
                ? t(l.dependents > 1 ? '{tax} on {base} after {n} dependants' : '{tax} on {base} after {n} dependant', { tax: riel(l.tax.taxKhr), base: riel(l.tax.baseKhr), n: l.dependents })
                : t('{tax} on {base}', { tax: riel(l.tax.taxKhr), base: riel(l.tax.baseKhr) }))
              : t('{tax} (non-resident flat rate)', { tax: riel(l.tax.taxKhr) })} />
        )}
        {l.deductions.map((d, i) => <Row key={`d${i}`} label={d.name} value={d.amount} />)}
        {l.advances.map((d, i) => <Row key={`a${i}`} label={d.name} value={d.amount} hint={d.balance ? t('Still owed after this month: {amount}', { amount: money(d.balance, currency) }) : t('Fully repaid')} />)}
        {l.totalDeductions === 0 && <div className="faint small" style={{ padding: '5px 0' }}>{t('No deductions.')}</div>}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 4 }} />
        <Row label={t('Total deductions')} value={l.totalDeductions} strong />
      </div>

      <div className="card card-pad row between" style={{ background: 'var(--primary-soft)', boxShadow: 'none', borderColor: 'transparent' }}>
        <strong style={{ color: 'var(--primary)' }}>{t('Net pay')}</strong>
        <div className="right">
          <div style={{ fontSize: 22, fontWeight: 750, color: 'var(--primary)' }}>{money(l.net, currency)} {currency}</div>
          {currency === 'USD' && <div className="faint small">{t('{amount} at {rate} ៛/$', { amount: riel(l.netKhr), rate: exchangeRate.toLocaleString('en-US') })}</div>}
        </div>
      </div>
      <div className="faint small">
        {t('Paid to: {to}', { to: l.bank ? `${l.bank.name ?? t('Bank')} · ${l.bank.account}${l.bank.accountName ? ` · ${l.bank.accountName}` : ''}` : t('Cash') })}
      </div>
      {showEmployer && (l.nssf.employer > 0 || l.fringe.tax > 0) && (
        <div className="faint small">
          {t(l.fringe.tax > 0
            ? 'Employer also pays: NSSF {nssf} ({pension} pension, {health} health, {risk} risk) · fringe benefit tax {fringe}.'
            : 'Employer also pays: NSSF {nssf} ({pension} pension, {health} health, {risk} risk).',
          { nssf: money(l.nssf.employer, currency), pension: riel(l.nssf.pensionEmployerKhr), health: riel(l.nssf.healthKhr), risk: riel(l.nssf.riskKhr), fringe: money(l.fringe.tax, currency) })}
        </div>
      )}
    </div>
  );
}
