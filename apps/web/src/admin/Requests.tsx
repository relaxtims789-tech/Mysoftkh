import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { isAdmin, useAuth } from '../lib/auth';
import { addDays, dateTime, LEAVE_TYPES, shortDate, time12, todayIso } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Badge, Empty, ErrorText, Field, Loading, Modal, useAction, useConfirm, useLoad } from '../components/ui';
import type { CorrectionItem } from '../employee/Corrections';
import type { LeaveItem } from '../employee/Leave';
import { REQUEST_TONE } from '../employee/Leave';
import { PageHead } from './shared';

const STATUS_TABS = [['pending', t('Pending')], ['approved', t('Approved')], ['rejected', t('Rejected')], ['all', t('All')]];
const STATUS_LABEL: Record<string, string> = { pending: t('Pending'), approved: t('Approved'), rejected: t('Rejected'), cancelled: t('Cancelled') };
const NO_CORRECTIONS: Record<string, string> = { pending: t('No pending corrections.'), approved: t('No approved corrections.'), rejected: t('No rejected corrections.'), all: t('No corrections.') };
const NO_LEAVE: Record<string, string> = { pending: t('No pending leave requests.'), approved: t('No approved leave requests.'), rejected: t('No rejected leave requests.'), all: t('No leave requests.') };

export function CorrectionsAdmin() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [status, setStatus] = useState('pending');
  const [adding, setAdding] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api<CorrectionItem[]>('/corrections', { query: { status: status === 'all' ? undefined : status } }), [status]);
  const { run, error: actionError } = useAction();
  const confirm = useConfirm();

  const review = async (c: CorrectionItem, decision: 'approve' | 'reject') => {
    const note = await confirm({
      title: decision === 'approve' ? t('Approve correction?') : t('Reject correction?'),
      message: <>{t('{name}: {type} on {date}', { name: c.employeeName, type: tServer(c.typeLabel), date: shortDate(c.workDate) })} → <b>{time12(c.requestedTime)}</b> {c.currentTime ? t('(currently {time}).', { time: time12(c.currentTime) }) : t('(currently missing).')} {t('Reason: “{reason}”.', { reason: c.reason })}</>,
      confirm: decision === 'approve' ? t('Approve') : t('Reject'),
      danger: decision === 'reject',
      input: { label: t('Note (optional)') },
    });
    if (note === false) return;
    await run(() => api(`/corrections/${c.id}/${decision}`, { body: { note: note || undefined } }), decision === 'approve' ? t('Correction approved') : t('Correction rejected'));
    reload();
  };

  return (
    <>
      <PageHead title={t('Attendance corrections')} sub={t('Every approval writes a correction record and an audit-log entry.')}>
        {admin && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> {t('Add correction')}</button>}
      </PageHead>
      <div className="card">
        <div className="tabs" style={{ padding: '0 8px' }}>
          {STATUS_TABS.map(([k, l]) => <button key={k} className={`tab${status === k ? ' active' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <ErrorText error={error || actionError} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Date')}</th><th>{t('Scan')}</th><th>{t('Current')}</th><th>{t('Requested')}</th><th>{t('Reason')}</th><th>{t('Status')}</th><th></th></tr></thead>
              <tbody>
                {data?.length === 0 && <tr><td colSpan={8}><Empty icon="wrench">{NO_CORRECTIONS[status] ?? t('No corrections.')}</Empty></td></tr>}
                {data?.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/admin/employees/${c.employeeId}`}><b>{c.employeeName}</b></Link><div className="faint small">{c.employeeCode} · {c.department ?? ''}</div></td>
                    <td className="nowrap">{shortDate(c.workDate)}</td>
                    <td>{tServer(c.typeLabel)}</td>
                    <td>{time12(c.currentTime)}</td>
                    <td><b>{time12(c.requestedTime)}</b></td>
                    <td className="small" style={{ maxWidth: 260 }}>{c.reason}<div className="faint">{t('by {name}', { name: c.requestedBy })} · {dateTime(c.createdAt)}</div></td>
                    <td><Badge tone={REQUEST_TONE[c.status]}>{STATUS_LABEL[c.status] ?? c.status}</Badge>{c.reviewedBy && <div className="faint small">{c.reviewedBy}</div>}</td>
                    <td>
                      {admin && c.status === 'pending' && (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn sm good" onClick={() => review(c, 'approve')}>{t('Approve')}</button>
                          <button className="btn sm danger" onClick={() => review(c, 'reject')}>{t('Reject')}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <ManualCorrectionForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

/** HR adds or fixes a scan directly (saved as an approved correction, audited). */
export function ManualCorrectionForm({ employeeId, employeeName, onClose, onSaved }: { employeeId?: string; employeeName?: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ employeeId: employeeId ?? '', workDate: addDays(todayIso(), -1), attendanceType: 'check_in', time: '08:00', reason: '' });
  const [search, setSearch] = useState('');
  const results = useLoad(() => (search.trim().length >= 2 && !employeeId ? api('/employees', { query: { search, pageSize: 8 } }).then((r) => r.items) : Promise.resolve([])), [search]);
  const [picked, setPicked] = useState(employeeName ?? '');
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api('/corrections/manual', { body: f }), t('Correction saved'))) onSaved();
  }

  return (
    <Modal title={t('Add correction')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" form="corr-form" disabled={busy || !f.employeeId}>{busy ? t('Saving…') : t('Save correction')}</button>
      </>
    }>
      <form id="corr-form" className="stack" onSubmit={submit}>
        {employeeId ? (
          <Field label={t('Employee')}><div className="input" style={{ display: 'flex', alignItems: 'center' }}>{employeeName}</div></Field>
        ) : (
          <Field label={t('Employee')} hint={picked ? t('Selected: {name}', { name: picked }) : t('Type at least 2 letters of the name or ID')}>
            <input className="input" value={search} onChange={(e) => { setSearch(e.target.value); setF({ ...f, employeeId: '' }); setPicked(''); }} placeholder={t('Search employee')} />
            {!f.employeeId && (results.data?.length ?? 0) > 0 && (
              <div className="card" style={{ maxHeight: 200, overflow: 'auto' }}>
                {results.data!.map((e: any) => (
                  <button type="button" key={e.id} className="btn ghost block" style={{ justifyContent: 'flex-start' }} onClick={() => { setF({ ...f, employeeId: e.id }); setPicked(`${e.name} (${e.employeeCode})`); setSearch(`${e.name} (${e.employeeCode})`); }}>
                    {e.name} <span className="faint small">{e.employeeCode} · {e.department ?? ''}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}
        <div className="grid3">
          <Field label={t('Date')}><input type="date" className="input" max={todayIso()} value={f.workDate} onChange={(e) => setF({ ...f, workDate: e.target.value })} required /></Field>
          <Field label={t('Scan')}>
            <select className="select" value={f.attendanceType} onChange={(e) => setF({ ...f, attendanceType: e.target.value })}>
              <option value="check_in">{t('Check-in')}</option><option value="check_out">{t('Check-out')}</option><option value="lunch_out">{t('Lunch-out')}</option><option value="lunch_in">{t('Lunch-in')}</option>
            </select>
          </Field>
          <Field label={t('Time')}><input type="time" className="input" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} required /></Field>
        </div>
        <Field label={t('Reason')}><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} placeholder={t('e.g. Forgot to scan, confirmed by manager')} /></Field>
        <p className="faint small">{t('Any existing scan of this type on that day is replaced (kept as void for the audit trail).')}</p>
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}

export function LeaveAdmin() {
  const [status, setStatus] = useState('pending');
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<LeaveItem[]>('/leave', { query: { status: status === 'all' ? undefined : status } }), [status]);
  const { run, error: actionError } = useAction();
  const confirm = useConfirm();

  const review = async (l: LeaveItem, decision: 'approve' | 'reject') => {
    const note = await confirm({
      title: decision === 'approve' ? t('Approve leave?') : t('Reject leave?'),
      message: <>{l.employeeName}: {LEAVE_TYPES[l.leaveType]}, {shortDate(l.startDate)}{l.endDate !== l.startDate ? ` → ${shortDate(l.endDate)}` : ''} ({t(l.days === 1 ? '{n} day' : '{n} days', { n: l.days })}).</>,
      confirm: decision === 'approve' ? t('Approve') : t('Reject'),
      danger: decision === 'reject',
      input: { label: t('Note (optional)') },
    });
    if (note === false) return;
    await run(() => api(`/leave/${l.id}/${decision}`, { body: { note: note || undefined } }), decision === 'approve' ? t('Leave approved') : t('Leave rejected'));
    reload();
  };

  return (
    <>
      <PageHead title={t('Leave requests')} sub={user?.role === 'manager' ? t('Requests from your departments.') : t('Approved leave shows as LEAVE instead of absent.')} />
      <div className="card">
        <div className="tabs" style={{ padding: '0 8px' }}>
          {STATUS_TABS.map(([k, l]) => <button key={k} className={`tab${status === k ? ' active' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <ErrorText error={error || actionError} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Type')}</th><th>{t('Dates')}</th><th className="num">{t('Days')}</th><th>{t('Reason')}</th><th>{t('Status')}</th><th></th></tr></thead>
              <tbody>
                {data?.length === 0 && <tr><td colSpan={7}><Empty icon="leave">{NO_LEAVE[status] ?? t('No leave requests.')}</Empty></td></tr>}
                {data?.map((l) => (
                  <tr key={l.id}>
                    <td><Link to={`/admin/employees/${l.employeeId}`}><b>{l.employeeName}</b></Link><div className="faint small">{l.employeeCode} · {l.department ?? ''}</div></td>
                    <td>{LEAVE_TYPES[l.leaveType]}</td>
                    <td className="nowrap">{shortDate(l.startDate)}{l.endDate !== l.startDate ? ` → ${shortDate(l.endDate)}` : ''}</td>
                    <td className="num">{l.days}</td>
                    <td className="small" style={{ maxWidth: 260 }}>{l.reason ?? '—'}</td>
                    <td><Badge tone={REQUEST_TONE[l.status]}>{STATUS_LABEL[l.status] ?? l.status}</Badge>{l.approvedBy && <div className="faint small">{l.approvedBy}</div>}</td>
                    <td>
                      {l.status === 'pending' && l.employeeId !== user?.employee?.id && (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn sm good" onClick={() => review(l, 'approve')}>{t('Approve')}</button>
                          <button className="btn sm danger" onClick={() => review(l, 'reject')}>{t('Reject')}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
