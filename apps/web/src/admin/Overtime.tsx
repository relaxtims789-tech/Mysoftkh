import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../lib/api';
import { hm, shortDate, time12, todayIso } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Badge, Empty, ErrorText, Loading, useAction, useConfirm, useLoad } from '../components/ui';
import { PageHead, Select, useDepartments } from './shared';

interface OtRow {
  employeeId: string; employeeCode: string; name: string; department: string | null; workDate: string; dayType: 'work_day' | 'day_off' | 'holiday';
  checkIn: string | null; checkOut: string | null; workedMinutes: number; overtimeMinutes: number; countedMinutes: number;
  status: 'not_required' | 'pending' | 'approved' | 'rejected'; reason: string | null; reviewNote: string | null; reviewedBy: string | null;
  pay: { hours: number; weightedHours: number | null; paidDays: number; amount: number | null };
  ifApproved: { hours: number; weightedHours: number | null; paidDays: number; amount: number | null } | null;
}
interface OtList { policy: { requiresApproval: boolean; currency: string; showPay: boolean }; rows: OtRow[] }

const DAY: Record<string, [string, string]> = { work_day: [t('Work day'), 'muted'], day_off: [t('Day off'), 'info'], holiday: [t('Holiday'), 'primary'] };
const STATUS: Record<string, [string, string]> = { not_required: [t('Counted'), 'good'], pending: [t('Pending'), 'warn'], approved: [t('Approved'), 'good'], rejected: [t('Rejected'), 'bad'] };
const key = (r: OtRow) => `${r.employeeId}|${r.workDate}`;

/** Overtime days: approve (all or fewer minutes) or reject, one by one or many at once. */
export function OvertimeAdmin() {
  const today = todayIso();
  const [q, setQ] = useState({ from: `${today.slice(0, 7)}-01`, to: today, status: 'pending', departmentId: '' });
  const departments = useDepartments();
  const { data, error, loading, reload } = useLoad(() => api<OtList>('/overtime', { query: q }), [q]);
  const [minutes, setMinutes] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { busy, run, error: actionError } = useAction();
  const confirm = useConfirm();
  const approval = data?.policy.requiresApproval;
  const showPay = data?.policy.showPay;
  const cur = data?.policy.currency ?? 'USD';
  const rows = data?.rows ?? [];
  const pendingRows = rows.filter((r) => r.status === 'pending');

  const review = async (items: OtRow[], decision: 'approve' | 'reject') => {
    let note: string | false = '';
    if (decision === 'reject') {
      note = await confirm({ title: t(items.length > 1 ? 'Reject {n} overtime days?' : 'Reject {n} overtime day?', { n: items.length }), message: t('Rejected overtime is not paid.'), confirm: t('Reject'), danger: true, input: { label: t('Note (optional)') } });
      if (note === false) return;
    }
    await run(() => api('/overtime/review', {
      body: { items: items.map((r) => ({ employeeId: r.employeeId, workDate: r.workDate, decision, note: note || undefined, minutes: decision === 'approve' && minutes[key(r)] !== undefined && minutes[key(r)] !== '' ? Number(minutes[key(r)]) : undefined })) },
    }), decision === 'approve' ? t('Overtime approved') : t('Overtime rejected'));
    setSelected(new Set());
    reload();
  };

  const totals = rows.reduce((sum, r) => ({ ot: sum.ot + r.overtimeMinutes, counted: sum.counted + r.countedMinutes, amount: sum.amount + (r.pay.amount ?? 0) }), { ot: 0, counted: 0, amount: 0 });

  return (
    <>
      <PageHead title={t('Overtime')} sub={approval ? t('Overtime counts for pay only after it is approved.') : t('Approval is off: all overtime counts automatically. Turn it on in Settings → Overtime.')}>
        <input type="date" className="input" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} aria-label={t('From')} />
        <input type="date" className="input" value={q.to} max={today} onChange={(e) => setQ({ ...q, to: e.target.value })} aria-label={t('To')} />
        <Select value={q.departmentId} onChange={(v) => setQ({ ...q, departmentId: v })} options={departments} placeholder={t('All departments')} />
        <button className="btn" onClick={() => run(() => download('/reports/export', { type: 'overtime-pay', format: 'xlsx', from: q.from, to: q.to, departmentId: q.departmentId }))}>
          <Icon name="download" size={16} /> {t('Payroll (Excel)')}
        </button>
      </PageHead>
      <div className="card">
        <div className="tabs" style={{ padding: '0 8px' }}>
          {(approval ? [['pending', t('Pending')], ['approved', t('Approved')], ['rejected', t('Rejected')], ['all', t('All')]] : [['all', t('All overtime')]]).map(([k, l]) => (
            <button key={k} className={`tab${q.status === k || (!approval && k === 'all') ? ' active' : ''}`} onClick={() => setQ({ ...q, status: k })}>{l}</button>
          ))}
        </div>
        <ErrorText error={error || actionError} />
        {approval && pendingRows.length > 0 && (
          <div className="toolbar" style={{ padding: 12 }}>
            <span className="small muted">{t('{n} selected', { n: selected.size })}</span>
            <button className="btn sm" onClick={() => setSelected(new Set(pendingRows.map(key)))}>{t('Select all pending')}</button>
            <button className="btn sm good" disabled={!selected.size || busy} onClick={() => review(pendingRows.filter((r) => selected.has(key(r))), 'approve')}><Icon name="check" size={14} /> {t('Approve selected')}</button>
            <button className="btn sm danger" disabled={!selected.size || busy} onClick={() => review(pendingRows.filter((r) => selected.has(key(r))), 'reject')}>{t('Reject selected')}</button>
          </div>
        )}
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {approval && <th style={{ width: 28 }}></th>}
                  <th>{t('Employee')}</th><th>{t('Date')}</th><th>{t('Day')}</th><th>{t('In → Out')}</th><th className="num">OT</th>
                  {approval && <th className="num">{t('Approve (min)')}</th>}
                  <th className="num">{t('Weighted h')}</th>{showPay && <th className="num">{t('Pay ({currency})', { currency: cur })}</th>}
                  <th>{t('Reason')}</th><th>{t('Status')}</th>{approval && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={12}><Empty icon="clock">{approval && q.status !== 'all' ? t('No overtime in this period with status "{status}".', { status: STATUS[q.status]?.[0] ?? q.status }) : t('No overtime in this period.')}</Empty></td></tr>}
                {rows.map((r) => (
                  <tr key={key(r)}>
                    {approval && (
                      <td>{r.status === 'pending' && (
                        <input type="checkbox" checked={selected.has(key(r))} onChange={(e) => {
                          const s = new Set(selected);
                          if (e.target.checked) s.add(key(r)); else s.delete(key(r));
                          setSelected(s);
                        }} aria-label={t('Select {name} {date}', { name: r.name, date: r.workDate })} />
                      )}</td>
                    )}
                    <td><Link to={`/admin/employees/${r.employeeId}`}><b>{r.name}</b></Link><div className="faint small">{r.employeeCode} · {r.department ?? ''}</div></td>
                    <td className="nowrap">{shortDate(r.workDate)}</td>
                    <td><Badge tone={DAY[r.dayType][1]}>{DAY[r.dayType][0]}</Badge></td>
                    <td className="nowrap small">{time12(r.checkIn)} → {time12(r.checkOut)}<div className="faint">{t('worked {time}', { time: hm(r.workedMinutes) })}</div></td>
                    <td className="num nowrap">{hm(r.overtimeMinutes)}</td>
                    {approval && (
                      <td className="num">
                        {r.status === 'pending' ? (
                          <input className="input" style={{ width: 80, height: 30, textAlign: 'right' }} type="number" min={0} max={r.overtimeMinutes}
                            value={minutes[key(r)] ?? String(r.overtimeMinutes)} onChange={(e) => setMinutes({ ...minutes, [key(r)]: e.target.value })} aria-label={t('Minutes to approve')} />
                        ) : r.status === 'approved' ? `${r.countedMinutes}` : '—'}
                      </td>
                    )}
                    {(() => {
                      // Pending: show what approving the whole day would pay, in grey.
                      const p = r.status === 'pending' && r.ifApproved ? r.ifApproved : r.pay;
                      const grey = r.status === 'pending' ? { color: 'var(--text-3)' } : undefined;
                      return (
                        <>
                          <td className="num" style={grey}>{p.weightedHours ?? (p.paidDays ? t('{n} day', { n: p.paidDays }) : '')}</td>
                          {showPay && (
                            <td className="num" style={grey} title={r.status === 'pending' ? t('If approved') : undefined}>
                              {p.amount == null ? <span className="faint small" title={t('No salary or hourly rate on the employee')}>{t('no rate')}</span> : `${r.status === 'pending' ? '≈ ' : ''}${p.amount.toFixed(2)}`}
                            </td>
                          )}
                        </>
                      );
                    })()}
                    <td className="small" style={{ maxWidth: 200 }}>{r.reason ?? <span className="faint">—</span>}{r.reviewNote && <div className="faint">{t('Note: {note}', { note: r.reviewNote })}</div>}</td>
                    <td><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>{r.reviewedBy && <div className="faint small">{r.reviewedBy}</div>}</td>
                    {approval && (
                      <td>
                        {r.status === 'pending' && (
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn sm good" disabled={busy} onClick={() => review([r], 'approve')}>{t('Approve')}</button>
                            <button className="btn sm danger" disabled={busy} onClick={() => review([r], 'reject')}>{t('Reject')}</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length > 0 && (
                  <tr>
                    {approval && <td />}
                    <td colSpan={4}><b>{t('Total')}</b></td>
                    <td className="num"><b>{hm(totals.ot)}</b></td>
                    {approval && <td className="num"><b>{totals.counted}</b></td>}
                    <td />
                    {showPay && <td className="num"><b>{totals.amount.toFixed(2)}</b></td>}
                    <td colSpan={approval ? 3 : 2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showPay && rows.some((r) => r.pay.amount == null) && (
        <Alert tone="warn">{t('Some employees have no monthly salary or hourly rate, so their overtime cannot be priced. Add it in Employees → Edit.')}</Alert>
      )}
    </>
  );
}
