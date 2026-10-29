import { useEffect, useState } from 'react';
import { api, reloadMe } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Badge, ErrorText, Field, Loading, Modal, Switch, useAction, useConfirm, useLoad } from '../components/ui';
import { PageHead } from './shared';
import { OvertimeSettingsCard } from './OvertimeSettings';
import { TelegramGroupsCard } from './TelegramGroups';

interface Rules {
  allowButtonCheckin: boolean;
  allowLunchScan: boolean; requireGps: boolean; requireDeviceBinding: boolean; deviceApprovalMode: 'auto_first' | 'admin'; allowOvertime: boolean;
  overtimeMinMinutes: number; geofenceRadius: number; maxGpsAccuracy: number; minScanIntervalSeconds: number; restrictToHomeBranch: boolean; allowEmployeeCorrections: boolean;
}

const TIMEZONES = ['Asia/Phnom_Penh', 'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Vientiane', 'Asia/Yangon', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Jakarta', 'Asia/Manila', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

export function Settings() {
  const { user } = useAuth();
  const canEdit = user?.role === 'company_admin' || user?.role === 'super_admin';
  return (
    <>
      <PageHead title={t('Settings')} />
      {!canEdit && <Alert tone="info">{t('Only company administrators can change settings.')}</Alert>}
      <CompanyCard canEdit={canEdit} />
      <RulesCard canEdit={canEdit} />
      <OvertimeSettingsCard canEdit={canEdit} />
      {(canEdit || user?.role === 'hr') && <TelegramGroupsCard />}
      {canEdit && <IntegrationsCard />}
    </>
  );
}

function CompanyCard({ canEdit }: { canEdit: boolean }) {
  const { data, reload } = useLoad(() => api<{ id: string; name: string; code: string; logo: string | null; timezone: string }>('/companies/current'), []);
  const [f, setF] = useState({ name: '', code: '', timezone: '' });
  const { busy, error, run } = useAction();
  useEffect(() => { if (data) setF({ name: data.name, code: data.code, timezone: data.timezone }); }, [data]);
  if (!data) return <Loading />;

  async function uploadLogo(file: File) {
    const form = new FormData();
    form.append('file', file);
    if (await run(() => api('/companies/current/logo', { form }), t('Logo updated'))) { reload(); reloadMe(); }
  }

  return (
    <div className="card">
      <div className="card-head"><h2>{t('Company')}</h2></div>
      <div className="card-body stack">
        <div className="row" style={{ gap: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: 12, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff' }}>
            {data.logo ? <img src={data.logo} alt={t('Company logo')} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <Icon name="building" size={28} />}
          </div>
          {canEdit && (
            <label className="btn">
              <Icon name="upload" size={16} /> {t('Upload logo')}
              <input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            </label>
          )}
          <span className="faint small">{t('Printed on QR posters. PNG, JPEG or WebP, max 2 MB.')}</span>
        </div>
        <div className="grid3">
          <Field label={t('Company name')}><input className="input" value={f.name} disabled={!canEdit} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Company code')} hint={t('Employees type this when signing in.')}><input className="input" value={f.code} disabled={!canEdit} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label={t('Time zone')} hint={t('Attendance times and dates use this zone.')}>
            <select className="select" value={f.timezone} disabled={!canEdit} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {[...new Set([f.timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
        </div>
        <ErrorText error={error} />
        {canEdit && <div><button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api('/companies/current', { method: 'PUT', body: f }), t('Company saved'))) { reload(); reloadMe(); } }}>{t('Save company')}</button></div>}
      </div>
    </div>
  );
}

function RulesCard({ canEdit }: { canEdit: boolean }) {
  const { data, setData } = useLoad(() => api<Rules>('/settings/attendance-rules'), []);
  const [f, setF] = useState<Rules | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading />;
  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => setF({ ...f, [k]: v });
  const num = (k: keyof Rules) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as any);
  const weak = !f.requireGps || !f.requireDeviceBinding;

  return (
    <div className="card">
      <div className="card-head"><h2>{t('Attendance rules & security')}</h2></div>
      <div className="card-body stack" style={{ gap: 18 }}>
        <Alert tone={weak ? 'warn' : 'info'}>
          {t('A printed QR can be photographed and shared. Attendance stays trustworthy only with')} <b>{t('QR + employee sign-in + GPS geofence + phone binding')}</b> {t('together.')}
          {weak && ` ${t('One of these checks is off.')}`}
        </Alert>
        <div className="grid2" style={{ gap: 18 }}>
          <Switch checked={f.requireGps} disabled={!canEdit} onChange={(v) => set('requireGps', v)} label={t('Require GPS inside the branch radius')} hint={t('Scans outside the radius are rejected.')} />
          <Switch checked={f.requireDeviceBinding} disabled={!canEdit} onChange={(v) => set('requireDeviceBinding', v)} label={t("Require the employee's registered phone")} hint={t('Scans from any other phone are rejected.')} />
          <Switch checked={f.allowLunchScan} disabled={!canEdit} onChange={(v) => set('allowLunchScan', v)} label={t('Lunch-out / lunch-in scans')} hint={t('Employees scan when leaving for and returning from lunch.')} />
          <Switch checked={f.allowOvertime} disabled={!canEdit} onChange={(v) => set('allowOvertime', v)} label={t('Count overtime')} hint={t('Time after the end of work, and work on days off.')} />
          <Switch checked={f.restrictToHomeBranch} disabled={!canEdit} onChange={(v) => set('restrictToHomeBranch', v)} label={t("Only at the employee's own branch")} hint={t('Otherwise any branch of the company is accepted (and noted).')} />
          <Switch checked={f.allowEmployeeCorrections} disabled={!canEdit} onChange={(v) => set('allowEmployeeCorrections', v)} label={t('Employees may request corrections')} hint={t('“Forgot to scan” requests go to HR for approval.')} />
          <Switch
            checked={f.allowButtonCheckin}
            disabled={!canEdit}
            onChange={(v) => set('allowButtonCheckin', v)}
            label={t('Check-in / Check-out buttons (no QR scan)')}
            hint={t('Employees tap Check in / Check out on their phone without scanning. The phone must be inside a branch area; GPS and phone checks still apply.')}
          />
        </div>
        <div className="grid3">
          <Field label={t('New phones')} hint={t('How a phone becomes registered.')}>
            <select className="select" value={f.deviceApprovalMode} disabled={!canEdit} onChange={(e) => set('deviceApprovalMode', e.target.value as any)}>
              <option value="auto_first">{t('First phone approved automatically')}</option>
              <option value="admin">{t('Every phone needs approval')}</option>
            </select>
          </Field>
          <Field label={t('Default radius (m)')} hint={f.geofenceRadius < 20 ? t('Under 20 m: phone GPS is often less precise than that, so many check-ins may be refused.') : t('For branches without their own radius. 0.50 to 5000 m.')}><input type="number" inputMode="decimal" className="input" min={0.5} max={5000} step={0.01} value={f.geofenceRadius} disabled={!canEdit} onChange={num('geofenceRadius')} /></Field>
          <Field label={t('Max GPS inaccuracy (m)')} hint={t('Weaker GPS fixes are refused.')}><input type="number" className="input" min={5} max={5000} value={f.maxGpsAccuracy} disabled={!canEdit} onChange={num('maxGpsAccuracy')} /></Field>
          <Field label={t('Ignore repeat scans within (seconds)')} hint={t('“Attendance already recorded.”')}><input type="number" className="input" min={0} max={3600} value={f.minScanIntervalSeconds} disabled={!canEdit} onChange={num('minScanIntervalSeconds')} /></Field>
          <Field label={t('Minimum overtime (minutes)')} hint={t('Shorter stays after work are not overtime.')}><input type="number" className="input" min={0} max={600} value={f.overtimeMinMinutes} disabled={!canEdit} onChange={num('overtimeMinMinutes')} /></Field>
        </div>
        <ErrorText error={error} />
        {canEdit && <div><button className="btn primary" disabled={busy} onClick={async () => { const r = await run(() => api<Rules>('/settings/attendance-rules', { method: 'PUT', body: f }), t('Rules saved')); if (r) setData(r); }}>{t('Save rules')}</button></div>}
      </div>
    </div>
  );
}

function IntegrationsCard() {
  const { data, reload } = useLoad(() => api<{ id: string; name: string; keyPrefix: string; status: string; lastUsedAt: string | null; createdAt: string }[]>('/integrations/keys'), []);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  return (
    <div className="card">
      <div className="card-head"><h2>{t('Integrations')}</h2><a className="small" href="/api/docs" target="_blank" rel="noreferrer">{t('API documentation')} →</a></div>
      <div className="card-body stack">
        <p className="muted small">
          {t('ZKTeco fingerprint / face terminals (through a bridge), face-recognition and HR or payroll systems can push punches to')}
          <span className="mono"> POST /api/integrations/punches</span> {t('with an API key. They are stored in the same attendance table as QR scans.')}
        </p>
        <form className="toolbar" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api('/integrations/keys', { body: { name } })); if (r) { setNewKey(r.key); setName(''); reload(); } }}>
          <input className="input" placeholder={t('Key name, e.g. ZKTeco bridge')} value={name} onChange={(e) => setName(e.target.value)} required style={{ minWidth: 260 }} />
          <button className="btn" disabled={busy}><Icon name="key" size={16} /> {t('Create API key')}</button>
        </form>
        <ErrorText error={error} />
        {data && data.length > 0 && (
          <table className="table">
            <thead><tr><th>{t('Name')}</th><th>{t('Key')}</th><th>{t('Last used')}</th><th>{t('Status')}</th><th></th></tr></thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="mono">{k.keyPrefix}…</td>
                  <td className="small">{k.lastUsedAt ? dateTime(k.lastUsedAt) : t('Never')}</td>
                  <td><Badge tone={k.status === 'active' ? 'good' : 'muted'}>{k.status === 'active' ? t('Active') : k.status === 'revoked' ? t('Revoked') : k.status}</Badge></td>
                  <td className="right">{k.status === 'active' && <button className="btn sm danger" onClick={async () => {
                    if ((await confirm({ title: t('Revoke API key?'), message: t('Systems using "{name}" will stop being able to send punches.', { name: k.name }), confirm: t('Revoke'), danger: true })) === false) return;
                    await run(() => api(`/integrations/keys/${k.id}/revoke`, { method: 'POST' }), t('Key revoked'));
                    reload();
                  }}>{t('Revoke')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {newKey && (
        <Modal title={t('API key created')} onClose={() => setNewKey(null)} footer={<button className="btn primary" onClick={() => setNewKey(null)}>{t('I have copied it')}</button>}>
          <div className="stack">
            <Alert tone="warn">{t('Copy this key now. It is not shown again.')}</Alert>
            <div className="code-box">{newKey}</div>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(newKey)}>{t('Copy')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
