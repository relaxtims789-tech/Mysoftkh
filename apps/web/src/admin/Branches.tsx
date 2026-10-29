import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { isAdmin, useAuth } from '../lib/auth';
import { t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Badge, Empty, ErrorText, Field, Loading, Modal, useAction, useLoad, useToast } from '../components/ui';
import { Branch, invalidateRefs, PageHead } from './shared';
import { MapPicker } from './MapPicker';
import { parseCoordinates } from '../lib/geo';

export function Branches() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api<Branch[]>('/branches'), []);
  const rules = useLoad(() => api<{ geofenceRadius: number }>('/settings/attendance-rules'), []);
  const allowance = useLoad(() => api<{ used: number; limit: number | null; source: string }>('/branches/allowance').catch(() => null), [data]);
  const full = !!allowance.data && allowance.data.limit !== null && allowance.data.used >= allowance.data.limit;
  const canPay = user?.role === 'company_admin' || user?.role === 'super_admin';
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const defaultRadius = rules.data?.geofenceRadius ?? 100;

  return (
    <>
      <PageHead title={t('Branches')} sub={<>{t('Each branch has a GPS point and an allowed radius. Scans further away are rejected.')}{allowance.data?.limit != null && <> · <b>{t('{used} of {limit}', { used: allowance.data.used, limit: allowance.data.limit })}</b> {t(allowance.data.limit === 1 ? 'active branch used' : 'active branches used')}</>}</>}>
        {admin && <button className="btn primary" disabled={full} title={full ? t('Branch limit reached') : undefined} onClick={() => setEditing('new')}><Icon name="plus" size={16} /> {t('Add branch')}</button>}
      </PageHead>
      {admin && full && (
        <Alert tone="info">
          {t('Your plan allows')} <b>{allowance.data!.limit}</b> {t(allowance.data!.limit === 1 ? 'active branch.' : 'active branches.')} {canPay ? <>{t('To add more, choose a bigger plan in')} <Link to="/admin/billing">{t('Billing & plan')}</Link>{t(', or contact us.')}</> : t('Ask your company administrator to choose a bigger plan.')}
        </Alert>
      )}
      <ErrorText error={error} />
      {loading && !data && <Loading />}
      {data?.length === 0 && <div className="card"><Empty icon="building">{t('No branches yet. Add your first office.')}</Empty></div>}
      <div className="grid2">
        {data?.map((b) => (
          <div className="card" key={b.id}>
            <div className="card-head">
              <div>
                <h2>{b.name} <span className="faint small">{b.code}</span></h2>
                <div className="faint small">{b.address || `${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}`}</div>
              </div>
              <Badge tone={b.status === 'active' ? 'good' : 'muted'}>{b.status === 'active' ? t('Active') : t('Inactive')}</Badge>
            </div>
            <div className="card-body stack">
              <MapPicker lat={b.latitude} lng={b.longitude} radius={b.radius ?? defaultRadius} small />
              <div className="row wrap small muted" style={{ gap: 14 }}>
                <span><Icon name="pin" size={14} /> {t('Radius')} <b>{b.radius ?? defaultRadius} m</b>{b.radius == null && ` ${t('(default)')}`}</span>
                <span><Icon name="users" size={14} /> {t('{n} employees', { n: b.employeeCount ?? 0 })}</span>
                <span><Icon name="qr" size={14} /> {t('{n} active QR', { n: b.activeQrCount ?? 0 })}</span>
              </div>
              {admin && (
                <div className="row wrap">
                  <button className="btn sm" onClick={() => setEditing(b)}><Icon name="edit" size={14} /> {t('Edit')}</button>
                  {(b.activeQrCount ?? 0) === 0 ? (
                    <button className="btn sm primary" onClick={async () => {
                      try {
                        await api('/qr', { body: { branchId: b.id, label: t('Main entrance') } });
                        toast(t('QR code created'));
                        reload();
                      } catch (e) {
                        toast(tServer((e as Error).message), 'bad');
                      }
                    }}><Icon name="qr" size={14} /> {t('Generate QR')}</button>
                  ) : (
                    <Link className="btn sm" to={`/admin/qr?branchId=${b.id}`}><Icon name="printer" size={14} /> {t('QR codes')}</Link>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <BranchForm
          branch={editing === 'new' ? undefined : editing}
          defaultRadius={defaultRadius}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidateRefs('branches'); reload(); }}
        />
      )}
    </>
  );
}

function BranchForm({ branch, defaultRadius, onClose, onSaved }: { branch?: Branch; defaultRadius: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: branch?.name ?? '', code: branch?.code ?? '', address: branch?.address ?? '',
    latitude: branch?.latitude ?? 11.5564, longitude: branch?.longitude ?? 104.9282,
    radius: branch?.radius != null ? String(branch.radius) : '', status: branch?.status ?? 'active',
  });
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const [paste, setPaste] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');
  const { busy, error, run } = useAction();

  function useMyLocation() {
    setLocError('');
    if (!navigator.geolocation) return setLocError(t('This browser cannot read your location.'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setF((s) => ({ ...s, latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) }));
        if (p.coords.accuracy > 50) setLocError(t('Location accuracy is ±{n} m. Check the point on the map.', { n: Math.round(p.coords.accuracy) }));
      },
      (e) => { setLocating(false); setLocError(e.code === e.PERMISSION_DENIED ? t('Location permission was denied.') : t('Could not get your location.')); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...f, address: f.address.trim() || undefined, radius: f.radius === '' ? null : Number(f.radius), latitude: Number(f.latitude), longitude: Number(f.longitude) };
    const r = await run(() => (branch ? api(`/branches/${branch.id}`, { method: 'PUT', body }) : api('/branches', { body })), t('Branch saved'));
    if (r) onSaved();
  }

  const radius = f.radius === '' ? defaultRadius : Number(f.radius) || defaultRadius;
  return (
    <Modal title={branch ? t('Edit {name}', { name: branch.name }) : t('Add branch')} onClose={onClose} wide footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" form="branch-form" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
      </>
    }>
      <form id="branch-form" className="stack" onSubmit={submit}>
        <div className="grid2">
          <Field label={t('Branch name')} htmlFor="bn"><input id="bn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder={t('Phnom Penh Office')} /></Field>
          <Field label={t('Code')} htmlFor="bc" hint={t('Short code, e.g. PP. Used in reports and imports.')}><input id="bc" className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" /></Field>
        </div>
        <Field label={t('Address')} htmlFor="ba"><input id="ba" className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <MapPicker lat={Number(f.latitude)} lng={Number(f.longitude)} radius={radius} onChange={(lat, lng) => setF((s) => ({ ...s, latitude: lat, longitude: lng }))} />
        <div className="row wrap">
          <span className="faint small grow">{t('Click the map at the office entrance to set the point.')}</span>
          <button type="button" className="btn sm" onClick={useMyLocation} disabled={locating}><Icon name="pin" size={14} /> {locating ? t('Locating…') : t('Use my current location')}</button>
        </div>
        {locError && <Alert tone="warn">{locError}</Alert>}
        <Field
          label={t('Or paste coordinates / a Google Maps link')}
          htmlFor="bpaste"
          hint={pasteMsg || t('In Google Maps, right-click the entrance and click the numbers at the top of the menu to copy them, then paste here.')}
        >
          <input
            id="bpaste"
            className="input"
            value={paste}
            placeholder="11.5564, 104.9282"
            onChange={(e) => {
              setPaste(e.target.value);
              const c = parseCoordinates(e.target.value);
              if (c) {
                setF((s) => ({ ...s, latitude: Number(c.latitude.toFixed(6)), longitude: Number(c.longitude.toFixed(6)) }));
                setPasteMsg(t('Point set to {lat}, {lng}. Check it on the map.', { lat: c.latitude.toFixed(6), lng: c.longitude.toFixed(6) }));
              } else {
                setPasteMsg(e.target.value.trim() ? t('No coordinates found. Paste "latitude, longitude" or a Google Maps link that contains them.') : '');
              }
            }}
          />
        </Field>
        <div className="grid3">
          <Field label={t('Latitude')} htmlFor="blat"><input id="blat" className="input" type="number" step="any" min={-90} max={90} value={f.latitude} onChange={(e) => setF({ ...f, latitude: e.target.value as any })} required /></Field>
          <Field label={t('Longitude')} htmlFor="blng"><input id="blng" className="input" type="number" step="any" min={-180} max={180} value={f.longitude} onChange={(e) => setF({ ...f, longitude: e.target.value as any })} required /></Field>
          <Field label={t('Allowed radius (m)')} htmlFor="br" hint={t('0.50 to 5000 m. Empty = company default ({n} m)', { n: defaultRadius })}><input id="br" className="input" type="number" inputMode="decimal" min={0.5} max={5000} step={0.01} value={f.radius} onChange={(e) => setF({ ...f, radius: e.target.value })} placeholder={String(defaultRadius)} /></Field>
        </div>
        {branch && (
          <Field label={t('Status')} htmlFor="bs">
            <select id="bs" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">{t('Active')}</option><option value="inactive">{t('Inactive (QR codes stop working)')}</option>
            </select>
          </Field>
        )}
        {radius < 20 && (
          <Alert tone="warn">
            {t('A radius of {n} m is smaller than phone GPS can measure. Phones are usually accurate to 5–30 m outdoors and 20–50 m indoors, so many real check-ins would be refused as "outside the area". Use 20 m or more unless you have tested it on site.', { n: radius })}
          </Alert>
        )}
        <p className="faint small">{t('Tip: indoor GPS is often 20–50 m off. A radius of 100–150 m works well for most offices.')}</p>
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}
