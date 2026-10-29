import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { money, TAX_LABEL, TaxTreatment } from '../lib/payroll';
import { Icon } from '../components/Icon';
import { Badge, ErrorText, Field, useAction, useConfirm, useLoad } from '../components/ui';
import type { Employee } from './Employees';

interface Allowance { id: string; name: string; amount: number; tax: TaxTreatment }

/** Employee page: salary, tax and bank details, and the allowances paid every month. */
export function AllowancesCard({ employee: e, onEdit }: { employee: Employee; onEdit: () => void }) {
  const list = useLoad(() => api<Allowance[]>(`/payroll/employees/${e.id}/allowances`), [e.id]);
  const [f, setF] = useState({ name: '', amount: '', tax: 'salary' as TaxTreatment });
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const total = (list.data ?? []).reduce((s, a) => s + a.amount, 0);

  async function add(ev: FormEvent) {
    ev.preventDefault();
    const r = await run(() => api<Allowance[]>(`/payroll/employees/${e.id}/allowances`, { body: { name: f.name.trim(), amount: Number(f.amount), tax: f.tax } }), t('Allowance added'));
    if (r) {
      list.setData(r);
      setF({ name: '', amount: '', tax: 'salary' });
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('Pay & allowances')}</h2>
        <div className="row">
          <Link className="btn sm" to="/admin/payroll"><Icon name="money" size={14} /> {t('Payroll')}</Link>
          <button className="btn sm" onClick={onEdit}><Icon name="edit" size={14} /> {t('Edit pay details')}</button>
        </div>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <dl className="kv card-body" style={{ margin: 0 }}>
          <dt>{t('Monthly salary')}</dt><dd>{e.monthlySalary != null ? money(e.monthlySalary) : <span className="faint">{t('Not set')}</span>}</dd>
          <dt>{t('Hourly rate (OT)')}</dt><dd>{e.hourlyRate != null ? money(e.hourlyRate) : <span className="faint">{t('Salary ÷ hours per month')}</span>}</dd>
          <dt>{t('Tax')}</dt><dd>{e.taxResident === false ? t('Non-resident') : t('Resident')} · {t(e.dependents === 1 ? '{n} dependant' : '{n} dependants', { n: e.dependents ?? 0 })}</dd>
          <dt>{t('NSSF')}</dt><dd>{e.nssfEnrolled === false ? t('Not enrolled') : t('Enrolled')}</dd>
          <dt>{t('Paid to')}</dt><dd>{e.bankAccount ? <>{e.bankName ?? t('Bank')} · <span className="mono">{e.bankAccount}</span>{e.bankAccountName ? ` · ${e.bankAccountName}` : ''}</> : t('Cash')}</dd>
        </dl>
        <div className="card-body stack tight">
          <strong>{t('Monthly allowances')}</strong>
          {list.data?.length === 0 && <span className="faint small">{t('None. Added allowances are paid every month until removed.')}</span>}
          {list.data?.map((a) => (
            <div key={a.id} className="row between" style={{ borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
              <span>{a.name} {a.tax !== 'salary' && <Badge tone="muted">{a.tax === 'exempt' ? t('Tax-free') : t('Fringe')}</Badge>}</span>
              <span className="row">
                <b>{money(a.amount)}</b>
                <button className="btn ghost icon sm" aria-label={t('Remove {name}', { name: a.name })} onClick={async () => {
                  if ((await confirm({ title: t('Remove {name}?', { name: a.name }), message: t('It is no longer paid from the next calculation. Locked months keep it.'), confirm: t('Remove'), danger: true })) === false) return;
                  const r = await run(() => api<Allowance[]>(`/payroll/allowances/${a.id}`, { method: 'DELETE' }), t('Allowance removed'));
                  if (r) list.setData(r);
                }}><Icon name="trash" size={14} /></button>
              </span>
            </div>
          ))}
          {!!list.data?.length && <div className="row between small"><span className="faint">{t('Total per month')}</span><b>{money(total)}</b></div>}
          <form className="row wrap" style={{ gap: 8, alignItems: 'end' }} onSubmit={add}>
            <Field label={t('Allowance')}>
              <input className="input" list="allowance-names" style={{ width: 150 }} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} placeholder={t('e.g. Transport')} required minLength={2} maxLength={80} />
              <datalist id="allowance-names">{[t('Transport'), t('Meal'), t('Phone'), t('Housing'), t('Position allowance'), t('Skill allowance'), t('Attendance allowance')].map((n) => <option key={n} value={n} />)}</datalist>
            </Field>
            <Field label={t('Amount')}><input className="input" type="number" min={0.01} step={0.01} style={{ width: 100 }} value={f.amount} onChange={(ev) => setF({ ...f, amount: ev.target.value })} required /></Field>
            <Field label={t('Tax')}>
              <select className="select" style={{ width: 'auto' }} value={f.tax} onChange={(ev) => setF({ ...f, tax: ev.target.value as TaxTreatment })}>
                {(Object.keys(TAX_LABEL) as TaxTreatment[]).map((k) => <option key={k} value={k}>{TAX_LABEL[k]}</option>)}
              </select>
            </Field>
            <button className="btn" disabled={busy}><Icon name="plus" size={14} /> {t('Add')}</button>
          </form>
          <ErrorText error={error || list.error} />
        </div>
      </div>
    </div>
  );
}
