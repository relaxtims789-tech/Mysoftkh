import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, LEAVE_TYPES, monthLabel, shortDate, todayIso } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { money, PayLine, PayrollRun, previousMonth, riel, RUN_STATUS, TAX_LABEL, TaxTreatment } from '../lib/payroll';
import { Icon } from '../components/Icon';
import { PayslipView } from '../components/Payslip';
import { Alert, Badge, Empty, ErrorText, Field, Loading, Modal, Switch, useAction, useConfirm, useLoad } from '../components/ui';
import { PageHead } from './shared';

interface Bracket { upTo: number | null; rate: number }
interface Settings {
  currency: string; exchangeRate: number; baseFromAttendance: boolean; daysBasis: 'fixed' | 'schedule'; fixedDays: number; unpaidLeaveTypes: string[];
  lateDeduction: boolean; lateMode: 'per_minute' | 'per_time'; lateValue: number; lateFree: number; includeEarlyLeave: boolean;
  overtime: boolean; allowances: boolean; deductions: boolean; tax: boolean; nssf: boolean;
  taxBrackets: Bracket[]; dependentAllowance: number; nonResidentRate: number; fringeRate: number; pensionDeductible: boolean;
  nssfPensionEmployee: number; nssfPensionEmployer: number; nssfHealthEmployer: number; nssfRiskEmployer: number; nssfMinWage: number; nssfMaxWage: number;
}
interface Advance {
  id: string; employeeId: string; employeeCode: string; employeeName: string; amount: number; installment: number; startMonth: string; issuedOn: string;
  note: string | null; repaid: number; payments: number; balance: number; status: 'active' | 'repaid' | 'cancelled'; createdBy: string | null;
}
interface Item { id: string; employeeId: string; kind: 'earning' | 'deduction'; name: string; amount: number; tax: TaxTreatment; createdBy: string | null }

const useCanLock = () => {
  const { user } = useAuth();
  return user?.role === 'company_admin' || user?.role === 'super_admin';
};

/** Payroll: months, salary advances, settings. */
export function PayrollHome() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'months';
  return (
    <>
      <PageHead title={t('Payroll')} sub={t('Monthly pay from salary, attendance, approved overtime, allowances, Tax on Salary and NSSF.')} />
      <div className="card">
        <div className="tabs" style={{ padding: '0 8px' }}>
          {[['months', t('Months')], ['advances', t('Salary advances')], ['settings', t('Settings')]].map(([k, l]) => (
            <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setParams(k === 'months' ? {} : { tab: k })}>{l}</button>
          ))}
        </div>
        {tab === 'months' && <MonthsTab />}
        {tab === 'advances' && <AdvancesTab />}
        {tab === 'settings' && <div className="card-body"><PayrollSettingsForm /></div>}
      </div>
    </>
  );
}

function MonthsTab() {
  const navigate = useNavigate();
  const runs = useLoad(() => api<PayrollRun[]>('/payroll/runs'), []);
  const settings = useLoad(() => api<Settings>('/payroll/settings'), []);
  const [month, setMonth] = useState(previousMonth);
  const [rate, setRate] = useState('');
  const { busy, error, run } = useAction();
  const existing = runs.data?.find((r) => r.month === month);
  const usd = settings.data?.currency === 'USD';

  async function start(e: FormEvent) {
    e.preventDefault();
    if (existing) return navigate(`/admin/payroll/${month}`);
    const r = await run(() => api(`/payroll/runs/${month}/calculate`, { body: { exchangeRate: rate ? Number(rate) : undefined } }), t('Payroll calculated'));
    if (r) navigate(`/admin/payroll/${month}`);
  }

  return (
    <>
      <form className="toolbar" style={{ padding: 12, alignItems: 'end' }} onSubmit={start}>
        <Field label={t('Month')}>
          <input className="input" type="month" value={month} max={todayIso().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} required />
        </Field>
        {usd && !existing && (
          <Field label={t('Exchange rate (៛ per $1)')}>
            <input className="input" type="number" min={1} step={0.01} style={{ width: 150 }} value={rate} placeholder={String(settings.data?.exchangeRate ?? 4100)} onChange={(e) => setRate(e.target.value)} />
          </Field>
        )}
        <button className="btn primary" disabled={busy || !month}>
          <Icon name={existing ? 'right' : 'plus'} size={16} /> {existing ? t('Open {month}', { month: monthLabel(month) }) : busy ? t('Calculating…') : t('Calculate {month}', { month: month ? monthLabel(month) : '' })}
        </button>
      </form>
      <ErrorText error={error || runs.error} />
      {runs.loading && !runs.data ? <Loading /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>{t('Month')}</th><th>{t('Status')}</th><th className="num">{t('Employees')}</th><th className="num">{t('Gross')}</th><th className="num">{t('Tax on salary')}</th><th className="num">{t('NSSF')}</th><th className="num">{t('Net pay')}</th><th>{t('Approved')}</th></tr>
            </thead>
            <tbody>
              {runs.data?.length === 0 && <tr><td colSpan={8}><Empty icon="file">{t('No payroll yet. Choose a month above and calculate it.')}</Empty></td></tr>}
              {runs.data?.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/admin/payroll/${r.month}`)}>
                  <td><b>{monthLabel(r.month)}</b></td>
                  <td><Badge tone={RUN_STATUS[r.status][1]}>{RUN_STATUS[r.status][0]}</Badge></td>
                  <td className="num">{r.totals.employees}</td>
                  <td className="num">{money(r.totals.gross, r.currency)}</td>
                  <td className="num">{money(r.totals.tax, r.currency)}</td>
                  <td className="num">{money(r.totals.nssfEmployee + r.totals.nssfEmployer, r.currency)}</td>
                  <td className="num"><b>{money(r.totals.net, r.currency)}</b> <span className="faint small">{r.currency}</span></td>
                  <td className="small">{r.approvedAt ? <>{shortDate(r.approvedAt.slice(0, 10))}<div className="faint">{r.approvedBy}</div></> : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** One month: totals, every employee line, approve / paid / unlock, downloads. */
export function PayrollRunPage() {
  const { month = '' } = useParams();
  const navigate = useNavigate();
  const canLock = useCanLock();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useLoad(() => api<{ run: PayrollRun; lines: PayLine[] }>(`/payroll/runs/${month}`), [month]);
  const { busy, run, error: actionError } = useAction();
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  useEffect(() => { if (data) setRate(String(data.run.exchangeRate)); }, [data?.run.exchangeRate]);

  const lines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.lines ?? []).filter((l) => !q || l.name.toLowerCase().includes(q) || l.employeeCode.toLowerCase().includes(q) || (l.department ?? '').toLowerCase().includes(q));
  }, [data, search]);

  if (loading && !data) return <Loading />;
  if (!data) return <><Link to="/admin/payroll" className="small"><Icon name="left" size={14} /> {t('Payroll')}</Link><ErrorText error={error} /></>;
  const { run: r } = data;
  const tot = r.totals;
  const c = r.currency;
  const draft = r.status === 'draft';
  const open = data.lines.find((l) => l.employeeId === openId) ?? null;
  const act = async (path: string, body: object, ok: string) => {
    const res = await run(() => api<{ run: PayrollRun; lines: PayLine[] }>(`/payroll/runs/${month}/${path}`, { body }), ok);
    if (res) setData(res);
  };

  return (
    <>
      <div className="row"><Link to="/admin/payroll" className="small"><Icon name="left" size={14} /> {t('Payroll')}</Link></div>
      <PageHead
        title={t('Payroll {month}', { month: monthLabel(month) })}
        sub={<>
          <Badge tone={RUN_STATUS[r.status][1]}>{RUN_STATUS[r.status][0]}</Badge>{' '}
          <span className="faint small">
            {r.calculatedBy ? t('Calculated {date} by {name}', { date: dateTime(r.calculatedAt), name: r.calculatedBy }) : t('Calculated {date}', { date: dateTime(r.calculatedAt) })}
            {r.approvedAt && ` · ${t('approved {date} by {name}', { date: dateTime(r.approvedAt), name: r.approvedBy })}`}
            {r.paidAt && ` · ${t('paid {date}', { date: dateTime(r.paidAt) })}`}
          </span>
        </>}
      >
        <button className="btn" onClick={() => run(() => download(`/payroll/runs/${month}/export`, { kind: 'summary', format: 'xlsx' }))}><Icon name="download" size={16} /> {t('Payroll (Excel)')}</button>
        <button className="btn" onClick={() => run(() => download(`/payroll/runs/${month}/export`, { kind: 'bank', format: 'xlsx' }))}><Icon name="download" size={16} /> {t('Bank transfers')}</button>
        <button className="btn" onClick={() => run(() => download(`/payroll/runs/${month}/export`, { kind: 'payslips' }))}><Icon name="printer" size={16} /> {t('All payslips (PDF)')}</button>
      </PageHead>

      <div className="card card-pad row wrap" style={{ gap: 10 }}>
        {draft ? (
          <>
            {c === 'USD' && (
              <label className="row small" style={{ gap: 6 }}>{t('Exchange rate')}
                <input className="input" type="number" min={1} step={0.01} style={{ width: 110, height: 34 }} value={rate} onChange={(e) => setRate(e.target.value)} aria-label={t('Exchange rate')} /> ៛/$
              </label>
            )}
            <button className="btn" disabled={busy} onClick={() => act('calculate', { exchangeRate: c === 'USD' && rate ? Number(rate) : undefined }, t('Payroll recalculated'))}>
              <Icon name="refresh" size={16} /> {t('Recalculate')}
            </button>
            {canLock && (
              <button className="btn primary" disabled={busy} onClick={async () => {
                const ok = await confirm({
                  title: t('Approve and lock {month}?', { month: monthLabel(month) }),
                  message: (
                    <div className="stack tight">
                      <span>{t('The payroll is recalculated with the latest attendance, then locked. Attendance, overtime, leave and pay items of this month cannot change until a company admin unlocks it. Employees can see their payslips.')}</span>
                      {tot.pendingOtDays > 0 && <Alert tone="warn">{t(tot.pendingOtDays > 1 ? '{n} overtime days are still waiting for approval and will not be paid.' : '{n} overtime day is still waiting for approval and will not be paid.', { n: tot.pendingOtDays })}</Alert>}
                    </div>
                  ),
                  confirm: t('Approve & lock'),
                });
                if (ok !== false) act('approve', {}, t('Payroll approved and locked'));
              }}><Icon name="check" size={16} /> {t('Approve & lock')}</button>
            )}
            <span className="grow" />
            <button className="btn ghost danger" disabled={busy} onClick={async () => {
              if ((await confirm({ title: t('Delete this draft?'), message: t('The calculated lines are removed. Pay items, allowances and advances are kept.'), confirm: t('Delete'), danger: true })) === false) return;
              const ok = await run(() => api(`/payroll/runs/${month}`, { method: 'DELETE' }), t('Draft deleted'));
              if (ok) navigate('/admin/payroll');
            }}>{t('Delete draft')}</button>
          </>
        ) : (
          <>
            <Icon name="shield" />
            <span className="grow small">{t('Locked. To change anything, a company admin unlocks it back to draft.')}{r.note && ` ${t('Last unlock: {note}', { note: r.note })}`}</span>
            {canLock && r.status === 'approved' && (
              <button className="btn good" disabled={busy} onClick={async () => {
                if ((await confirm({ title: t('Mark as paid?'), message: t('Salaries for {month} have been transferred or paid in cash.', { month: monthLabel(month) }), confirm: t('Mark as paid') })) !== false) act('paid', {}, t('Marked as paid'));
              }}><Icon name="check" size={16} /> {t('Mark as paid')}</button>
            )}
            {canLock && (
              <button className="btn" disabled={busy} onClick={async () => {
                const reason = await confirm({ title: t('Unlock payroll?'), message: t('It goes back to draft so it can be adjusted and recalculated. Advance repayments of this month are undone until it is approved again.'), confirm: t('Unlock'), danger: true, input: { label: t('Reason'), placeholder: t('e.g. Missing bonus for the sales team'), required: true } });
                if (reason) act('unlock', { reason }, t('Payroll unlocked'));
              }}><Icon name="key" size={16} /> {t('Unlock')}</button>
            )}
          </>
        )}
      </div>
      <ErrorText error={actionError} />
      {draft && r.note && <Alert tone="info">{t('Unlocked: {note}', { note: r.note })}</Alert>}
      {tot.pendingOtDays > 0 && draft && (
        <Alert tone="warn">{t(tot.pendingOtDays > 1 ? '{n} overtime days are waiting for approval and not included.' : '{n} overtime day is waiting for approval and not included.', { n: tot.pendingOtDays })} <Link to="/admin/overtime">{t('Review overtime')}</Link>{t(', then recalculate.')}</Alert>
      )}

      <div className="kpis">
        <div className="card kpi"><span className="k-label">{t('Employees')}</span><span className="k-value">{tot.employees}</span><span className="k-sub">{tot.warnings ? t('{n} need a look', { n: tot.warnings }) : t('All complete')}</span></div>
        <div className="card kpi"><span className="k-label">{t('Gross pay')}</span><span className="k-value">{money(tot.gross, c)}</span><span className="k-sub">{t('OT {ot} · allowances {allowances}', { ot: money(tot.otPay, c), allowances: money(tot.earnings, c) })}</span></div>
        <div className="card kpi"><span className="k-label">{t('Tax on salary')}</span><span className="k-value">{money(tot.tax, c)}</span><span className="k-sub">{riel(tot.taxKhr)}{tot.fringeTax ? ` · ${t('fringe {amount}', { amount: money(tot.fringeTax, c) })}` : ''}</span></div>
        <div className="card kpi"><span className="k-label">{t('NSSF')}</span><span className="k-value">{money(tot.nssfEmployee + tot.nssfEmployer, c)}</span><span className="k-sub">{t('staff {staff} · employer {employer}', { staff: money(tot.nssfEmployee, c), employer: money(tot.nssfEmployer, c) })}</span></div>
        <div className="card kpi"><span className="k-label">{t('Net pay ({currency})', { currency: c })}</span><span className="k-value" style={{ color: 'var(--primary)' }}>{money(tot.net, c)}</span><span className="k-sub">{c === 'USD' ? t('{amount} at {rate}', { amount: riel(tot.netKhr), rate: r.exchangeRate.toLocaleString('en-US') }) : ''}</span></div>
        <div className="card kpi"><span className="k-label">{t('Bank transfers')}</span><span className="k-value">{money(tot.bankTotal, c)}</span><span className="k-sub">{t('{n} people · cash {cash} ({amount})', { n: tot.bankCount, cash: tot.cashCount, amount: money(tot.cashTotal, c) })}</span></div>
      </div>

      <div className="card">
        <div className="toolbar" style={{ padding: 12 }}>
          <div className="search"><Icon name="search" size={16} /><input className="input" placeholder={t('Name, ID, department')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <span className="faint small">{draft ? t('Click an employee for the full payslip, bonuses and deductions.') : t('Click an employee for the full payslip.')}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Employee')}</th><th className="num">{t('Worked')}</th><th className="num">{t('Unpaid')}</th><th className="num">{t('Base pay')}</th><th className="num">{t('Overtime')}</th>
                <th className="num">{t('Allow. & bonus')}</th><th className="num">{t('Gross')}</th><th className="num">{t('NSSF')}</th><th className="num">{t('Tax')}</th><th className="num">{t('Deductions')}</th>
                <th className="num">{t('Net ({currency})', { currency: c })}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={12}><Empty icon="users">{t('No employees.')}</Empty></td></tr>}
              {lines.map((l) => (
                <tr key={l.employeeId} className="clickable" onClick={() => setOpenId(l.employeeId)}>
                  <td><b>{l.name}</b><div className="faint small">{l.employeeCode}{l.department ? ` · ${l.department}` : ''}</div></td>
                  <td className="num">{l.days.worked}</td>
                  <td className="num" style={{ color: l.unpaidDays ? 'var(--bad)' : undefined }}>{l.unpaidDays || ''}</td>
                  <td className="num">{money(l.basePay - l.lateDeduction, c)}</td>
                  <td className="num">{l.otPay ? money(l.otPay, c) : ''}</td>
                  <td className="num">{l.earningsTotal ? money(l.earningsTotal, c) : ''}</td>
                  <td className="num">{money(l.gross, c)}</td>
                  <td className="num">{l.nssf.employee ? money(l.nssf.employee, c) : ''}</td>
                  <td className="num">{l.tax.tax ? money(l.tax.tax, c) : ''}</td>
                  <td className="num">{l.deductionsTotal + l.advancesTotal ? money(l.deductionsTotal + l.advancesTotal, c) : ''}</td>
                  <td className="num"><b>{money(l.net, c)}</b></td>
                  <td>{l.warnings.length > 0 && <span title={l.warnings.map(tServer).join('\n')} style={{ color: 'var(--warn)' }}><Icon name="alert" size={16} /></span>}</td>
                </tr>
              ))}
              {lines.length > 0 && (
                <tr>
                  <td><b>{t('Total')}</b></td><td /><td />
                  <td className="num"><b>{money(tot.basePay - tot.lateDeduction, c)}</b></td>
                  <td className="num"><b>{money(tot.otPay, c)}</b></td>
                  <td className="num"><b>{money(tot.earnings, c)}</b></td>
                  <td className="num"><b>{money(tot.gross, c)}</b></td>
                  <td className="num"><b>{money(tot.nssfEmployee, c)}</b></td>
                  <td className="num"><b>{money(tot.tax, c)}</b></td>
                  <td className="num"><b>{money(tot.deductions + tot.advances, c)}</b></td>
                  <td className="num"><b>{money(tot.net, c)}</b></td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {open && <LineModal line={open} run={r} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function LineModal({ line, run: r, onClose, onChanged }: { line: PayLine; run: PayrollRun; onClose: () => void; onChanged: () => void }) {
  const draft = r.status === 'draft';
  const items = useLoad(() => api<Item[]>('/payroll/items', { query: { month: r.month, employeeId: line.employeeId } }), [line.employeeId, r.month]);
  const [f, setF] = useState({ kind: 'earning' as 'earning' | 'deduction', name: '', amount: '', tax: 'salary' as TaxTreatment });
  const { busy, error, run } = useAction();
  const confirm = useConfirm();

  async function add(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api('/payroll/items', { body: { employeeId: line.employeeId, month: r.month, kind: f.kind, name: f.name.trim(), amount: Number(f.amount), tax: f.kind === 'earning' ? f.tax : undefined } }), t('Added'));
    if (ok) {
      setF({ ...f, name: '', amount: '' });
      items.reload();
      onChanged();
    }
  }

  return (
    <Modal title={<>{line.name} <span className="faint small">{line.employeeCode} · {monthLabel(r.month)}</span></>} onClose={onClose} wide footer={
      <>
        <Link className="btn" to={`/admin/employees/${line.employeeId}`}>{t('Employee page')}</Link>
        <button className="btn" onClick={() => run(() => download(`/payroll/runs/${r.month}/export`, { kind: 'payslips', employeeId: line.employeeId }))}><Icon name="printer" size={16} /> {t('Payslip PDF')}</button>
        <button className="btn primary" onClick={onClose}>{t('Close')}</button>
      </>
    }>
      <div className="grid2" style={{ alignItems: 'start', gap: 20 }}>
        <div className="stack">
          {line.warnings.map((w) => <Alert key={w} tone="warn">{tServer(w)}</Alert>)}
          <PayslipView line={line} currency={r.currency} exchangeRate={r.exchangeRate} showEmployer />
        </div>
        <div className="stack">
          <h3 style={{ margin: 0 }}>{t('This month only')}</h3>
          <p className="faint small" style={{ margin: 0 }}>{t('Bonus, commission or extra allowance; or a deduction such as a penalty or uniform. Monthly allowances are set on the employee page.')}</p>
          {items.data?.length === 0 && <div className="faint small">{t('Nothing added for this month.')}</div>}
          {items.data?.map((i) => (
            <div key={i.id} className="row between" style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
              <span>
                <Badge tone={i.kind === 'earning' ? 'good' : 'bad'}>{i.kind === 'earning' ? '+' : '−'}</Badge> {i.name}
                <span className="faint small" style={{ display: 'block' }}>{i.kind === 'earning' ? TAX_LABEL[i.tax] : t('Deduction')}{i.createdBy ? ` · ${i.createdBy}` : ''}</span>
              </span>
              <span className="row">
                <b>{money(i.amount, r.currency)}</b>
                {draft && (
                  <button className="btn ghost icon sm" aria-label={t('Remove')} onClick={async () => {
                    if ((await confirm({ title: t('Remove "{name}"?', { name: i.name }), message: t('The payslip is recalculated.'), confirm: t('Remove'), danger: true })) === false) return;
                    const ok = await run(() => api(`/payroll/items/${i.id}`, { method: 'DELETE' }), t('Removed'));
                    if (ok) { items.reload(); onChanged(); }
                  }}><Icon name="trash" size={15} /></button>
                )}
              </span>
            </div>
          ))}
          {draft ? (
            <form className="stack tight card card-pad" style={{ boxShadow: 'none' }} onSubmit={add}>
              <div className="grid2">
                <Field label={t('Type')}>
                  <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'earning' | 'deduction' })}>
                    <option value="earning">{t('Add to pay')}</option><option value="deduction">{t('Deduct from pay')}</option>
                  </select>
                </Field>
                <Field label={t('Amount ({currency})', { currency: r.currency })}>
                  <input className="input" type="number" min={0.01} step={0.01} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
                </Field>
              </div>
              <Field label={t('Name')}>
                <input className="input" list="pay-item-names" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'earning' ? t('e.g. Sales commission') : t('e.g. Uniform')} required minLength={2} maxLength={80} />
                <datalist id="pay-item-names">
                  {(f.kind === 'earning' ? [t('Bonus'), t('Sales commission'), t('Attendance bonus'), t('Seniority payment'), t('Phone allowance'), t('Khmer New Year bonus')] : [t('Penalty'), t('Uniform'), t('Loss or damage'), t('Loan repayment')]).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              {f.kind === 'earning' && (
                <Field label={t('Tax')}>
                  <select className="select" value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value as TaxTreatment })}>
                    {(Object.keys(TAX_LABEL) as TaxTreatment[]).map((k) => <option key={k} value={k}>{TAX_LABEL[k]}</option>)}
                  </select>
                </Field>
              )}
              <ErrorText error={error} />
              <div><button className="btn primary" disabled={busy}><Icon name="plus" size={16} /> {t('Add')}</button></div>
            </form>
          ) : (
            <Alert tone="info">{t('This month is locked. A company admin can unlock it to make changes.')}</Alert>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AdvancesTab() {
  const [status, setStatus] = useState('active');
  const { data, error, loading, reload } = useLoad(() => api<Advance[]>('/payroll/advances', { query: { status } }), [status]);
  const [adding, setAdding] = useState(false);
  const { run, error: actionError } = useAction();
  const confirm = useConfirm();
  return (
    <>
      <div className="toolbar" style={{ padding: 12 }}>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">{t('Being repaid')}</option><option value="repaid">{t('Repaid')}</option><option value="cancelled">{t('Cancelled')}</option><option value="all">{t('All')}</option>
        </select>
        <span className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> {t('New advance')}</button>
      </div>
      <ErrorText error={error || actionError} />
      {loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Employee')}</th><th>{t('Given')}</th><th className="num">{t('Amount')}</th><th className="num">{t('Per month')}</th><th>{t('From')}</th><th className="num">{t('Repaid')}</th><th className="num">{t('Still owed')}</th><th>{t('Status')}</th><th></th></tr></thead>
            <tbody>
              {data?.length === 0 && <tr><td colSpan={9}><Empty icon="file">{t('No salary advances.')}</Empty></td></tr>}
              {data?.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/admin/employees/${a.employeeId}`}><b>{a.employeeName}</b></Link><div className="faint small">{a.employeeCode}{a.note ? ` · ${a.note}` : ''}</div></td>
                  <td className="nowrap">{shortDate(a.issuedOn)}</td>
                  <td className="num">{money(a.amount)}</td>
                  <td className="num">{money(a.installment)}</td>
                  <td className="nowrap">{monthLabel(a.startMonth)}</td>
                  <td className="num">{money(a.repaid)}<div className="faint small">{t(a.payments === 1 ? '{n} month' : '{n} months', { n: a.payments })}</div></td>
                  <td className="num"><b>{money(a.balance)}</b></td>
                  <td><Badge tone={a.status === 'active' ? 'warn' : a.status === 'repaid' ? 'good' : 'muted'}>{a.status === 'active' ? t('Being repaid') : a.status === 'repaid' ? t('Repaid') : t('Cancelled')}</Badge></td>
                  <td>{a.status === 'active' && (
                    <button className="btn sm" onClick={async () => {
                      if ((await confirm({ title: t('Stop repayments?'), message: t("Nothing more is taken from {name}'s pay for this advance. Repayments in locked months stay.", { name: a.employeeName }), confirm: t('Stop repayments'), danger: true })) === false) return;
                      await run(() => api(`/payroll/advances/${a.id}/cancel`, { method: 'POST' }), t('Advance cancelled'));
                      reload();
                    }}>{t('Cancel')}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint small" style={{ padding: '0 12px 12px' }}>{t('Each month the repayment is taken from net pay until the advance is repaid. It is recorded when the month is approved.')}</p>
      {adding && <AdvanceForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

function AdvanceForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const employees = useLoad(() => api<{ items: { id: string; name: string; employeeCode: string }[] }>('/employees', { query: { status: 'active', pageSize: 1000 } }), []);
  const [f, setF] = useState({ employeeId: '', amount: '', installment: '', startMonth: todayIso().slice(0, 7), issuedOn: todayIso(), note: '' });
  const { busy, error, run } = useAction();
  const months = f.amount && f.installment ? Math.ceil(Number(f.amount) / Number(f.installment)) : 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api('/payroll/advances', { body: { ...f, amount: Number(f.amount), installment: Number(f.installment), note: f.note || undefined } }), t('Advance saved'));
    if (ok) onSaved();
  }
  return (
    <Modal title={t('New salary advance')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" form="adv-form" disabled={busy}>{t('Save')}</button></>}>
      <form id="adv-form" className="stack" onSubmit={submit}>
        <Field label={t('Employee')}>
          <select className="select" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} required>
            <option value="">{t('Choose…')}</option>
            {employees.data?.items.map((e) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.name}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label={t('Amount given')}><input className="input" type="number" min={0.01} step={0.01} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
          <Field label={t('Repay per month')} hint={months ? t(months > 1 ? 'Repaid in {n} months' : 'Repaid in {n} month', { n: months }) : undefined}><input className="input" type="number" min={0.01} step={0.01} value={f.installment} onChange={(e) => setF({ ...f, installment: e.target.value })} required /></Field>
          <Field label={t('Date given')}><input className="input" type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} required /></Field>
          <Field label={t('First repayment in')}><input className="input" type="month" value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value })} required /></Field>
        </div>
        <Field label={t('Note (optional)')}><input className="input" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}

/** Pay items on/off, salary days, late deduction, exchange rate, Tax on Salary and NSSF rates. */
export function PayrollSettingsForm() {
  const canEdit = useCanLock();
  const { data, setData } = useLoad(() => api<Settings>('/payroll/settings'), []);
  const [f, setF] = useState<Settings | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });
  const num = (k: keyof Settings) => ({
    className: 'input', type: 'number', disabled: !canEdit, value: String(f[k] as number),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as any),
  });
  const sw = (k: keyof Settings, label: string, hint: string) => (
    <Switch checked={f[k] as boolean} disabled={!canEdit} onChange={(v) => set(k, v as any)} label={label} hint={hint} />
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      {!canEdit && <Alert tone="info">{t('Only company administrators can change payroll settings.')}</Alert>}
      <section className="stack">
        <h3 style={{ margin: 0 }}>{t('What payroll includes')}</h3>
        {sw('baseFromAttendance', t('Base salary from attendance'), t('Unpaid absent days, unpaid leave and days before starting are taken off the monthly salary. Off = full salary every month.'))}
        {sw('lateDeduction', t('Late / early-leave deduction'), t('Take pay off for minutes late (and leaving early), after free minutes.'))}
        {sw('overtime', t('Overtime pay'), t('Approved overtime priced with the rates in Settings → Overtime.'))}
        {sw('allowances', t('Allowances & bonuses'), t("Monthly allowances on each employee and this month's bonuses / commissions."))}
        {sw('deductions', t('Deductions & salary advances'), t('One-off deductions and advance repayments.'))}
        {sw('tax', t('Tax on Salary (Cambodia)'), t('Progressive tax worked out in riel.'))}
        {sw('nssf', t('NSSF contributions'), t('Pension for the employee; pension, health care and occupational risk for the employer.'))}
      </section>

      <section className="stack">
        <h3 style={{ margin: 0 }}>{t('Salary days & currency')}</h3>
        <div className="grid3">
          <Field label={t('Daily rate = salary ÷')}>
            <select className="select" value={f.daysBasis} disabled={!canEdit} onChange={(e) => set('daysBasis', e.target.value as Settings['daysBasis'])}>
              <option value="fixed">{t('A fixed number of days')}</option>
              <option value="schedule">{t('Working days in that month (schedule)')}</option>
            </select>
          </Field>
          {f.daysBasis === 'fixed' && <Field label={t('Days per month')}><input {...num('fixedDays')} min={1} max={31} step={0.5} /></Field>}
          <Field label={t('Currency')}>
            <select className="select" value={f.currency} disabled={!canEdit} onChange={(e) => set('currency', e.target.value)}>
              {['USD', 'KHR', 'THB', 'VND'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          {f.currency === 'USD' && <Field label={t('Exchange rate (៛ per $1)')} hint={t('Suggested for new months; each month keeps its own rate.')}><input {...num('exchangeRate')} min={1} step={0.01} /></Field>}
        </div>
        <Field label={t('Unpaid leave types')} hint={t('Days of these leave types are not paid. Other approved leave is paid.')}>
          <div className="row wrap" style={{ gap: 12 }}>
            {Object.entries(LEAVE_TYPES).map(([k, l]) => (
              <label key={k} className="row small" style={{ gap: 6 }}>
                <input type="checkbox" disabled={!canEdit} checked={f.unpaidLeaveTypes.includes(k)} onChange={(e) => set('unpaidLeaveTypes', e.target.checked ? [...f.unpaidLeaveTypes, k] : f.unpaidLeaveTypes.filter((x) => x !== k))} />
                {l}
              </label>
            ))}
          </div>
        </Field>
      </section>

      {f.lateDeduction && (
        <section className="stack">
          <h3 style={{ margin: 0 }}>{t('Late / early leave')}</h3>
          <div className="grid3">
            <Field label={t('Deduct')}>
              <select className="select" value={f.lateMode} disabled={!canEdit} onChange={(e) => set('lateMode', e.target.value as Settings['lateMode'])}>
                <option value="per_minute">{t('Per minute (× minute rate)')}</option>
                <option value="per_time">{t('Fixed amount per time')}</option>
              </select>
            </Field>
            <Field label={f.lateMode === 'per_minute' ? t('Multiplier of the minute rate') : t('{currency} per time', { currency: f.currency })}><input {...num('lateValue')} min={0} step={0.01} /></Field>
            <Field label={f.lateMode === 'per_minute' ? t('Free minutes per month') : t('Free times per month')}><input {...num('lateFree')} min={0} step={1} /></Field>
          </div>
          {sw('includeEarlyLeave', t('Also count leaving early'), t('Minutes / times leaving before the end of work are added to late.'))}
        </section>
      )}

      {f.tax && (
        <section className="stack">
          <h3 style={{ margin: 0 }}>{t('Tax on Salary (riel per month)')}</h3>
          <div className="table-wrap card" style={{ boxShadow: 'none', maxWidth: 520 }}>
            <table className="table">
              <thead><tr><th>{t('From')}</th><th>{t('Up to')}</th><th className="num">{t('Rate %')}</th><th /></tr></thead>
              <tbody>
                {f.taxBrackets.map((b, i) => (
                  <tr key={i}>
                    <td className="faint">{riel(i === 0 ? 0 : (f.taxBrackets[i - 1].upTo ?? 0) + 1)}</td>
                    <td>{b.upTo === null ? <span className="faint">{t('and above')}</span> : (
                      <input className="input" type="number" min={0} disabled={!canEdit} style={{ width: 140, height: 30 }} value={b.upTo}
                        onChange={(e) => set('taxBrackets', f.taxBrackets.map((x, j) => (j === i ? { ...x, upTo: Number(e.target.value) } : x)))} />
                    )}</td>
                    <td className="num">
                      <input className="input" type="number" min={0} max={100} step={0.5} disabled={!canEdit} style={{ width: 80, height: 30, textAlign: 'right' }} value={b.rate}
                        onChange={(e) => set('taxBrackets', f.taxBrackets.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)))} />
                    </td>
                    <td>{canEdit && b.upTo !== null && f.taxBrackets.length > 2 && (
                      <button className="btn ghost icon sm" aria-label={t('Remove bracket')} onClick={() => set('taxBrackets', f.taxBrackets.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div><button className="btn sm" onClick={() => {
              const list = [...f.taxBrackets];
              const lastFixed = list.length > 1 ? list[list.length - 2].upTo ?? 0 : 0;
              list.splice(list.length - 1, 0, { upTo: lastFixed + 1000000, rate: list[list.length - 1].rate });
              set('taxBrackets', list);
            }}><Icon name="plus" size={14} /> {t('Add bracket')}</button></div>
          )}
          <div className="grid3">
            <Field label={t('Allowance per dependant (៛)')} hint={t('Non-working spouse and children.')}><input {...num('dependentAllowance')} min={0} step={1000} /></Field>
            <Field label={t('Non-resident rate %')}><input {...num('nonResidentRate')} min={0} max={100} step={0.5} /></Field>
            <Field label={t('Fringe benefit tax %')} hint={t('On allowances marked as fringe benefit; paid by the employer.')}><input {...num('fringeRate')} min={0} max={100} step={0.5} /></Field>
          </div>
          {sw('pensionDeductible', t('Deduct the employee NSSF pension before tax'), t('The pension contribution is taken off the taxable salary.'))}
        </section>
      )}

      {f.nssf && (
        <section className="stack">
          <h3 style={{ margin: 0 }}>{t('NSSF (% of the wage in riel)')}</h3>
          <div className="grid3">
            <Field label={t('Pension: employee %')}><input {...num('nssfPensionEmployee')} min={0} max={100} step={0.1} /></Field>
            <Field label={t('Pension: employer %')}><input {...num('nssfPensionEmployer')} min={0} max={100} step={0.1} /></Field>
            <Field label={t('Health care: employer %')}><input {...num('nssfHealthEmployer')} min={0} max={100} step={0.1} /></Field>
            <Field label={t('Occupational risk: employer %')}><input {...num('nssfRiskEmployer')} min={0} max={100} step={0.1} /></Field>
            <Field label={t('Lowest wage counted (៛)')}><input {...num('nssfMinWage')} min={0} step={1000} /></Field>
            <Field label={t('Highest wage counted (៛)')}><input {...num('nssfMaxWage')} min={0} step={1000} /></Field>
          </div>
        </section>
      )}

      <Alert tone="info">{t('The defaults follow Cambodian rules for 2026: Tax on Salary 0–20% with a ៛150,000 allowance per dependant; NSSF pension 2% + 2%, health care 2.6% and occupational risk 0.8% on wages of ៛400,000–1,200,000. Check them with your accountant when the law changes.')}</Alert>
      <ErrorText error={error} />
      {canEdit && (
        <div>
          <button className="btn primary" disabled={busy} onClick={async () => {
            const r = await run(() => api<Settings>('/payroll/settings', { method: 'PUT', body: f }), t('Payroll settings saved'));
            if (r) setData(r);
          }}>{t('Save payroll settings')}</button>
        </div>
      )}
    </div>
  );
}
