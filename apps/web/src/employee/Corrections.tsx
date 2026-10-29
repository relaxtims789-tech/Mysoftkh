import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { addDays, shortDate, time12, todayIso } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Badge, Empty, ErrorText, Field, Loading, useAction, useLoad } from '../components/ui';
import { MobileTop } from './EmployeeApp';
import { REQUEST_STATUS, REQUEST_TONE } from './Leave';

export interface CorrectionItem {
  id: string; employeeId: string; employeeCode: string; employeeName: string; department: string | null; workDate: string; type: string; typeLabel: string;
  currentTime: string | null; requestedTime: string; reason: string; status: string; requestedBy: string | null; reviewedBy: string | null;
  reviewedAt: string | null; reviewNote: string | null; createdAt: string;
}

/** "Forgot to scan": the employee asks HR to add or fix a scan. */
export function CorrectionsScreen() {
  const { data, error, loading, reload } = useLoad(() => api<CorrectionItem[]>('/corrections', { query: { mine: true } }), []);
  const [form, setForm] = useState({ workDate: addDays(todayIso(), -1), attendanceType: 'check_in', time: '08:00', reason: '' });
  const { busy, error: saveError, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api('/corrections', { body: form }), t('Request sent to HR'));
    if (r) {
      setForm((f) => ({ ...f, reason: '' }));
      reload();
    }
  }

  return (
    <>
      <MobileTop title={t('Fix a scan')} />
      <div className="m-page">
        <form className="card card-pad stack" onSubmit={submit}>
          <h3>{t('Request a correction')}</h3>
          <p className="muted small">{t('Forgot to scan, or scanned the wrong thing? HR will review your request.')}</p>
          <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label={t('Date')} htmlFor="cd"><input id="cd" type="date" className="input" max={todayIso()} value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} required /></Field>
            <Field label={t('Time')} htmlFor="ct"><input id="ct" type="time" className="input" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required /></Field>
          </div>
          <Field label={t('Scan')} htmlFor="cty">
            <select id="cty" className="select" value={form.attendanceType} onChange={(e) => setForm({ ...form, attendanceType: e.target.value })}>
              <option value="check_in">{t('Check-in')}</option>
              <option value="check_out">{t('Check-out')}</option>
              <option value="lunch_out">{t('Lunch-out')}</option>
              <option value="lunch_in">{t('Lunch-in')}</option>
            </select>
          </Field>
          <Field label={t('Reason')} htmlFor="cr">
            <input id="cr" className="input" value={form.reason} minLength={3} maxLength={300} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t('e.g. Forgot to scan')} required />
          </Field>
          <ErrorText error={saveError} />
          <button className="btn primary" disabled={busy}>{busy ? t('Sending…') : t('Send request')}</button>
        </form>

        <h3>{t('My requests')}</h3>
        {loading && <Loading />}
        <ErrorText error={error} />
        {data && data.length === 0 && <div className="card"><Empty icon="wrench">{t('No correction requests.')}</Empty></div>}
        {data?.map((c) => (
          <div className="card card-pad stack tight" key={c.id}>
            <div className="row between">
              <strong>{tServer(c.typeLabel)} · {shortDate(c.workDate)}</strong>
              <Badge tone={REQUEST_TONE[c.status]}>{REQUEST_STATUS[c.status] ?? c.status[0].toUpperCase() + c.status.slice(1)}</Badge>
            </div>
            <div className="small">{t('Current:')} <b>{time12(c.currentTime)}</b> → {t('Requested:')} <b>{time12(c.requestedTime)}</b></div>
            <div className="small muted">{c.reason}</div>
            {c.reviewNote && <div className="small faint">{t('HR note: {note}', { note: c.reviewNote })}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
