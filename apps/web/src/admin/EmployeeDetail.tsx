import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { isAdmin, useAuth } from '../lib/auth';
import { dateTime, FLAG_LABEL, hm, monthLabel, monthRange, shortDate, SOURCE_LABEL, time12 } from '../lib/format';
import { KM_DAYS, lang, t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Avatar, Badge, DayBadge, ErrorText, Loading, Modal, useAction, useConfirm, useLoad, useToast } from '../components/ui';
import { Employee, EmployeeForm } from './Employees';
import { ManualCorrectionForm } from './Requests';
import { AllowancesCard } from './EmployeePay';

interface Detail extends Employee {
  login: { id: string; username: string; role: string; status: string; mustChangePassword: boolean; lastLoginAt: string | null } | null;
  devices: { id: string; deviceName: string | null; platform: string | null; status: string; registeredAt: string; approvedAt: string | null; lastUsedAt: string | null }[];
}

const DEVICE_TONE: Record<string, string> = { active: 'good', pending: 'warn', rejected: 'bad', revoked: 'muted' };
const DEVICE_STATUS: Record<string, string> = { active: t('Active'), pending: t('Pending'), rejected: t('Rejected'), revoked: t('Removed') };

function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function EmployeeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const admin = isAdmin(user);
  const confirm = useConfirm();
  const toast = useToast();
  const { run, error: actionError } = useAction();
  const [editing, setEditing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [secret, setSecret] = useState<{ username: string; companyCode: string; temporaryPassword: string } | null>(null);
  const [month, setMonth] = useState(thisMonth);
  const { data: e, error, loading, reload } = useLoad(() => api<Detail>(`/employees/${id}`), [id]);
  const range = monthRange(month);
  const hist = useLoad(() => api(`/attendance/history`, { query: { employeeId: id, ...range } }), [id, month]);

  if (loading && !e) return <Loading />;
  if (!e) return <ErrorText error={error} />;

  async function uploadPhoto(file: File) {
    const form = new FormData();
    form.append('file', file);
    await run(() => api(`/employees/${e!.id}/photo`, { form }), t('Photo updated'));
    reload();
  }

  const shift = (n: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };

  return (
    <>
      <div className="row"><Link to="/admin/employees" className="small"><Icon name="left" size={14} /> {t('Employees')}</Link></div>
      <div className="card card-pad row wrap" style={{ gap: 16 }}>
        <label style={{ cursor: admin ? 'pointer' : 'default' }} title={admin ? t('Change photo') : undefined}>
          <Avatar name={e.name} photo={e.profilePhoto} large />
          {admin && <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(ev) => ev.target.files?.[0] && uploadPhoto(ev.target.files[0])} />}
        </label>
        <div className="grow">
          <h1>{e.name}</h1>
          <div className="muted">{e.employeeCode} · {[e.position, e.department, e.branch].filter(Boolean).join(' · ')}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <Badge tone={e.status === 'active' ? 'good' : 'muted'}>{e.status === 'active' ? t('Active') : t('Disabled')}</Badge>
            {e.login?.mustChangePassword && <Badge tone="warn">{t('Temporary password')}</Badge>}
          </div>
        </div>
        {admin && (
          <div className="toolbar">
            <button className="btn" onClick={() => setCorrecting(true)}><Icon name="wrench" size={16} /> {t('Add correction')}</button>
            <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> {t('Edit')}</button>
            <button className="btn" onClick={async () => {
              if ((await confirm({ title: t('Reset password?'), message: t('{name} will get a temporary password and must choose a new one at next sign-in. Their current sessions end.', { name: e.name }), confirm: t('Reset password') })) === false) return;
              const r = await run(() => api(`/employees/${e.id}/reset-password`, { method: 'POST' }));
              if (r) setSecret(r);
              reload();
            }}><Icon name="key" size={16} /> {t('Reset password')}</button>
            {e.status === 'active' ? (
              <button className="btn danger" onClick={async () => {
                if ((await confirm({ title: t('Disable employee?'), message: t('{name} will not be able to sign in or scan. Attendance history is kept.', { name: e.name }), confirm: t('Disable'), danger: true })) === false) return;
                await run(() => api(`/employees/${e.id}`, { method: 'DELETE' }), t('Employee disabled'));
                reload();
              }}>{t('Disable')}</button>
            ) : (
              <button className="btn good" onClick={async () => { await run(() => api(`/employees/${e.id}`, { method: 'PUT', body: { status: 'active' } }), t('Employee enabled')); reload(); }}>{t('Enable')}</button>
            )}
          </div>
        )}
      </div>
      <ErrorText error={actionError} />

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>{t('Details')}</h2></div>
          <dl className="kv card-body" style={{ margin: 0 }}>
            <dt>{t('Phone')}</dt><dd>{e.phone ?? '—'}</dd>
            <dt>{t('Email')}</dt><dd>{e.email ?? '—'}</dd>
            <dt>{t('Department')}</dt><dd>{e.department ?? '—'}</dd>
            <dt>{t('Position')}</dt><dd>{e.position ?? '—'}</dd>
            <dt>{t('Branch')}</dt><dd>{e.branch ?? '—'}</dd>
            <dt>{t('Schedule')}</dt><dd>{e.schedule ?? t('Company default')}</dd>
            <dt>{t('Hired')}</dt><dd>{e.hiredOn ? shortDate(e.hiredOn) : '—'}</dd>
            <dt>{t('Log-in')}</dt><dd>{e.login ? <>{e.login.username} · {e.login.lastLoginAt ? t('last {time}', { time: dateTime(e.login.lastLoginAt) }) : t('never signed in')}</> : '—'}</dd>
          </dl>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>{t('Registered phones')}</h2>
            {admin && e.devices.some((d) => d.status === 'active' || d.status === 'pending') && (
              <button className="btn sm" onClick={async () => {
                if ((await confirm({ title: t('Reset phone?'), message: t('The registered phone is removed. The next phone the employee scans with becomes their new phone (or waits for approval, depending on Settings).'), confirm: t('Reset phone') })) === false) return;
                await run(() => api(`/employees/${e.id}/reset-device`, { method: 'POST' }), t('Phone reset'));
                reload();
              }}><Icon name="refresh" size={14} /> {t('Reset phone')}</button>
            )}
          </div>
          {e.devices.length === 0 ? <div className="card-body faint">{t('No phone registered yet. The first phone used to scan is registered.')}</div> : e.devices.map((d) => (
            <div className="feed-item" key={d.id}>
              <Icon name="phone" />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{d.deviceName ?? t('Phone')} <span className="faint small">{d.platform}</span></div>
                <div className="faint small">{t('Registered {date}', { date: dateTime(d.registeredAt) })}{d.lastUsedAt ? ` · ${t('last scan {date}', { date: dateTime(d.lastUsedAt) })}` : ''}</div>
              </div>
              <Badge tone={DEVICE_TONE[d.status]}>{DEVICE_STATUS[d.status] ?? d.status}</Badge>
              {admin && d.status === 'pending' && (
                <>
                  <button className="btn sm good" onClick={async () => { await run(() => api(`/devices/${d.id}/approve`, { method: 'POST' }), t('Phone approved')); reload(); }}>{t('Approve')}</button>
                  <button className="btn sm danger" onClick={async () => { await run(() => api(`/devices/${d.id}/reject`, { method: 'POST' }), t('Phone rejected')); reload(); }}>{t('Reject')}</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {admin && <AllowancesCard employee={e} onEdit={() => setEditing(true)} />}

      <div className="card">
        <div className="card-head">
          <div className="row">
            <button className="btn sm icon" onClick={() => shift(-1)} aria-label={t('Previous month')}><Icon name="left" size={16} /></button>
            <h2 style={{ minWidth: 150, textAlign: 'center' }}>{monthLabel(month)}</h2>
            <button className="btn sm icon" onClick={() => shift(1)} disabled={month >= thisMonth()} aria-label={t('Next month')}><Icon name="right" size={16} /></button>
          </div>
          {hist.data && (
            <div className="row wrap small muted" style={{ gap: 12 }}>
              <span>{t('Present')} <b>{hist.data.totals.present}</b></span>
              <span>{t('Late')} <b>{hist.data.totals.late}</b> {t('({n} min)', { n: hist.data.totals.lateMinutes })}</span>
              <span>{t('Absent')} <b>{hist.data.totals.absent}</b></span>
              <span>{t('Leave')} <b>{hist.data.totals.leave}</b></span>
              <span>OT <b>{hm(hist.data.totals.overtimeMinutes) || '0'}</b></span>
            </div>
          )}
        </div>
        {hist.loading && !hist.data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Date')}</th><th>{t('Check-in')}</th><th>{t('Check-out')}</th><th className="num">{t('Worked')}</th><th className="num">{t('Late')}</th><th className="num">OT</th><th>{t('Status')}</th><th>{t('Notes')}</th></tr></thead>
              <tbody>
                {hist.data?.days.filter((d: any) => d.status !== 'upcoming').map((d: any) => {
                  const cin = d.records.find((r: any) => r.type === 'check_in');
                  const outs = d.records.filter((r: any) => r.type === 'check_out');
                  return (
                    <tr key={d.date}>
                      <td className="nowrap">{shortDate(d.date)} <span className="faint small">{lang === 'km' ? KM_DAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()] : new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span></td>
                      <td>{cin ? time12(cin.time) : '—'}{cin && cin.source !== 'qr' && <span className="faint small"> ({SOURCE_LABEL[cin.source] ?? cin.source})</span>}</td>
                      <td>{outs.length ? time12(outs[outs.length - 1].time) : '—'}</td>
                      <td className="num">{hm(d.workedMinutes)}</td>
                      <td className="num">{d.lateMinutes || ''}</td>
                      <td className="num">{d.overtimeMinutes || ''}</td>
                      <td><DayBadge status={d.status} /></td>
                      <td className="small faint">{[d.holiday, ...d.flags.filter((f: string) => f !== 'overtime').map((f: string) => FLAG_LABEL[f])].filter(Boolean).join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <EmployeeForm employee={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {correcting && <ManualCorrectionForm employeeId={e.id} employeeName={e.name} onClose={() => setCorrecting(false)} onSaved={() => { setCorrecting(false); hist.reload(); toast(t('Correction saved')); }} />}
      {secret && (
        <Modal title={t('Temporary password')} onClose={() => setSecret(null)} footer={<button className="btn primary" onClick={() => setSecret(null)}>{t('Done')}</button>}>
          <div className="stack">
            <Alert tone="info">{t('Give this to {name}. It is shown only once.', { name: e.name })}</Alert>
            <dl className="kv">
              <dt>{t('Company code')}</dt><dd className="mono">{secret.companyCode}</dd>
              <dt>{t('Employee ID')}</dt><dd className="mono">{secret.username}</dd>
              <dt>{t('Temporary password')}</dt><dd className="mono">{secret.temporaryPassword}</dd>
            </dl>
          </div>
        </Modal>
      )}
    </>
  );
}
