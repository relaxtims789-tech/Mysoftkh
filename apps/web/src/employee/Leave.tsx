import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { LEAVE_TYPES, shortDate, todayIso } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Badge, Empty, ErrorText, Field, Loading, useAction, useConfirm, useLoad } from '../components/ui';
import { MobileTop } from './EmployeeApp';

export interface LeaveItem {
  id: string; employeeId: string; employeeCode: string; employeeName: string; department: string | null; leaveType: string; startDate: string; endDate: string;
  days: number; reason: string | null; status: string; approvedBy: string | null; approvedAt: string | null; reviewNote: string | null; createdAt: string;
}

export const REQUEST_TONE: Record<string, string> = { pending: 'warn', approved: 'good', rejected: 'bad', cancelled: 'muted' };
export const REQUEST_STATUS: Record<string, string> = { pending: t('Pending'), approved: t('Approved'), rejected: t('Rejected'), cancelled: t('Cancelled') };

export function LeaveScreen() {
  const { data, error, loading, reload } = useLoad(() => api<LeaveItem[]>('/leave', { query: { mine: true } }), []);
  const confirm = useConfirm();
  const { run } = useAction();
  return (
    <>
      <MobileTop title={t('Leave')} back={false} right={<Link className="btn primary sm" to="/app/leave/new"><Icon name="plus" size={16} />{t('Request')}</Link>} />
      <div className="m-page">
        {loading && <Loading />}
        <ErrorText error={error} />
        {data && data.length === 0 && <div className="card"><Empty icon="leave">{t('No leave requests yet.')}</Empty></div>}
        {data?.map((l) => (
          <div className="card card-pad stack tight" key={l.id}>
            <div className="row between">
              <strong>{LEAVE_TYPES[l.leaveType] ?? l.leaveType}</strong>
              <Badge tone={REQUEST_TONE[l.status]}>{REQUEST_STATUS[l.status] ?? l.status[0].toUpperCase() + l.status.slice(1)}</Badge>
            </div>
            <div className="muted">
              {shortDate(l.startDate)}{l.endDate !== l.startDate ? ` → ${shortDate(l.endDate)}` : ''} · {t(l.days === 1 ? '{n} day' : '{n} days', { n: l.days })}
            </div>
            {l.reason && <div className="small">{l.reason}</div>}
            {l.reviewNote && <div className="small faint">{t('Note: {note}', { note: l.reviewNote })}</div>}
            {l.status === 'pending' && (
              <div>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if ((await confirm({ title: t('Cancel this request?'), message: t('Your leave request will be withdrawn.'), confirm: t('Cancel request'), danger: true })) === false) return;
                    await run(() => api(`/leave/${l.id}/cancel`, { method: 'POST' }), t('Request cancelled'));
                    reload();
                  }}
                >
                  {t('Cancel request')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export function NewLeaveScreen() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ leaveType: 'annual', startDate: todayIso(), endDate: todayIso(), halfDay: false, reason: '' });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v, ...(k === 'startDate' && (v as string) > f.endDate ? { endDate: v as string } : {}) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api('/leave', { body: { ...form, endDate: form.halfDay ? form.startDate : form.endDate, reason: form.reason || undefined } }), t('Leave requested'));
    if (r) navigate('/app/leave', { replace: true });
  }

  return (
    <>
      <MobileTop title={t('Request leave')} />
      <form className="m-page" onSubmit={submit}>
        <Field label={t('Type of leave')} htmlFor="lt">
          <select id="lt" className="select input lg" value={form.leaveType} onChange={(e) => set('leaveType', e.target.value)}>
            {Object.entries(LEAVE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label={t('From')} htmlFor="sd"><input id="sd" type="date" className="input lg" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} required /></Field>
          <Field label={t('To')} htmlFor="ed"><input id="ed" type="date" className="input lg" value={form.halfDay ? form.startDate : form.endDate} min={form.startDate} disabled={form.halfDay} onChange={(e) => set('endDate', e.target.value)} required /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={form.halfDay} onChange={(e) => set('halfDay', e.target.checked)} /> {t('Half day')}</label>
        <Field label={t('Reason')} htmlFor="rs">
          <textarea id="rs" className="textarea" maxLength={500} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder={t('Optional')} />
        </Field>
        <p className="faint small">{t('Only working days are counted; weekends and public holidays are skipped.')}</p>
        <ErrorText error={error} />
        <button className="btn primary lg block" disabled={busy}>{busy ? t('Sending…') : t('Send request')}</button>
      </form>
    </>
  );
}
