import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, logout } from '../lib/api';
import { useAuth } from '../lib/auth';
import { deviceStatus, DeviceStatus, getDeviceKey, registerDevice } from '../lib/device';
import { dateTime } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { LangSwitch } from '../components/LangSwitch';
import { tx } from '../components/PhoneHelp';
import { Alert, Avatar, Badge, ErrorText, Loading, Switch, useAction, useLoad } from '../components/ui';
import { MobileTop } from './EmployeeApp';
import { isMiniApp, openTelegramLink, requestWriteAccess, telegramInitData } from '../lib/telegram';

export function ProfileScreen() {
  const { user } = useAuth();
  const e = user?.employee;
  if (!user || !e) return null;
  return (
    <>
      <MobileTop title={t('Profile')} back={false} />
      <div className="m-page">
        <div className="card card-pad stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Avatar name={e.name} photo={e.photo} large />
          <div>
            <h2>{e.name}</h2>
            <div className="muted">{[e.position, e.department].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="card card-pad">
          <dl className="kv" style={{ margin: 0, gridTemplateColumns: '110px 1fr' }}>
            <dt>{t('Employee ID')}</dt><dd>{e.code}</dd>
            <dt>{t('Company')}</dt><dd>{user.company?.name}</dd>
            <dt>{t('Branch')}</dt><dd>{e.branch ?? '—'}</dd>
            <dt>{t('Department')}</dt><dd>{e.department ?? '—'}</dd>
            <dt>{t('Position')}</dt><dd>{e.position ?? '—'}</dd>
            <dt>{t('Phone')}</dt><dd>{e.phone ?? '—'}</dd>
            <dt>{t('Email')}</dt><dd>{e.email ?? '—'}</dd>
          </dl>
          <p className="faint small" style={{ marginTop: 10 }}>{t('To change these details, contact HR.')}</p>
        </div>
        <div className="card">
          <div className="day-row">
            <Icon name="settings" /><span className="grow">Language / ភាសា</span><LangSwitch className="btn sm" />
          </div>
        </div>
        <div className="card">
          <Link className="day-row" to="/app/payslips" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Icon name="money" /><span className="grow">{t('My payslips')}</span><Icon name="right" size={16} />
          </Link>
          <Link className="day-row" to="/app/device" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Icon name="phone" /><span className="grow">{t('Registered phone')}</span><Icon name="right" size={16} />
          </Link>
          <Link className="day-row" to="/app/check" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Icon name="wrench" /><span className="grow">{t('Check my phone')}</span><Icon name="right" size={16} />
          </Link>
          <Link className="day-row" to="/app/corrections" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Icon name="wrench" /><span className="grow">{t('Attendance corrections')}</span><Icon name="right" size={16} />
          </Link>
          <Link className="day-row" to="/app/password" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Icon name="key" /><span className="grow">{t('Change password')}</span><Icon name="right" size={16} />
          </Link>
          {user.role !== 'employee' && (
            <a className="day-row" href="/admin" style={{ color: 'inherit', textDecoration: 'none' }}>
              <Icon name="chart" /><span className="grow">{t('Admin dashboard')}</span><Icon name="right" size={16} />
            </a>
          )}
        </div>
        <TelegramCard />
        <button className="btn danger block lg" onClick={() => logout()}><Icon name="logout" /> {t('Sign out')}</button>
      </div>
    </>
  );
}

interface MyDevice { id: string; deviceName: string | null; platform: string | null; status: string; registeredAt: string; lastUsedAt: string | null; current: boolean }

const DEVICE_TONE: Record<string, string> = { active: 'good', pending: 'warn', rejected: 'bad', revoked: 'muted' };
const DEVICE_STATUS: Record<string, string> = { active: t('Active'), pending: t('Pending'), rejected: t('Rejected'), revoked: t('Removed') };

/** Device registration: shows whether this phone is the registered one and lets the employee register it. */
export function DeviceScreen() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [id, setId] = useState<string>('');
  const { data, reload } = useLoad(async () => {
    const k = await getDeviceKey();
    setId(k.id);
    return api<MyDevice[]>('/devices/me', { query: { current: k.id } });
  }, []);
  const { busy, error, run } = useAction();

  const refresh = () => deviceStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    refresh();
  }, []);

  return (
    <>
      <MobileTop title={t('Registered phone')} />
      <div className="m-page">
        <div className="card card-pad stack">
          <div className="row"><Icon name="shield" size={22} /><h3>{t('Phone binding')}</h3></div>
          <p className="muted small">
            {t('Attendance can only be recorded from your registered phone. This phone holds a secret key that cannot be copied, and every scan is signed with it.')}
          </p>
          {!status && <Loading />}
          {status?.device?.status === 'active' && <Alert tone="good">{t('This phone is registered for attendance.')}</Alert>}
          {status?.device?.status === 'pending' && <Alert tone="warn">{tServer(status.message)}</Alert>}
          {(status?.device?.status === 'rejected' || status?.device?.status === 'revoked') && <Alert tone="bad">{tServer(status.message)}</Alert>}
          {status && !status.device && (
            <>
              <Alert tone="info">{t('This phone is not registered yet.')}</Alert>
              <button
                className="btn primary lg block"
                disabled={busy}
                onClick={async () => {
                  await run(() => registerDevice(), t('Phone registered'));
                  refresh();
                  reload();
                }}
              >
                <Icon name="phone" /> {t('Register this phone')}
              </button>
            </>
          )}
          <ErrorText error={error} />
          {id && <div className="faint small">{t('Device ID:')} <span className="mono">{id.slice(0, 16)}…</span></div>}
        </div>
        {data && data.length > 0 && (
          <div className="card">
            {data.map((d) => (
              <div className="day-row" key={d.id}>
                <Icon name="phone" />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{d.deviceName ?? t('Phone')} {d.current && <span className="faint">({t('this phone')})</span>}</div>
                  <div className="faint small">{t('Registered {date}', { date: dateTime(d.registeredAt) })}{d.lastUsedAt ? ` · ${t('last used {date}', { date: dateTime(d.lastUsedAt) })}` : ''}</div>
                </div>
                <Badge tone={DEVICE_TONE[d.status]}>{DEVICE_STATUS[d.status] ?? d.status}</Badge>
              </div>
            ))}
          </div>
        )}
        <p className="faint small center">{t('New phone? Ask HR to reset your device, then register the new phone here.')}</p>
      </div>
    </>
  );
}

interface TgStatus { available: boolean; botUsername: string | null; linked: boolean; username: string | null; notify: boolean }

/** Telegram: connected account and messages (check-in receipts, approvals, payslips, reminders). */
function TelegramCard() {
  const { data, setData } = useLoad(() => api<TgStatus>('/auth/telegram/status').catch(() => null), []);
  const { busy, error, run } = useAction();
  if (!data?.available) return null;
  const mini = isMiniApp();
  return (
    <div className="card card-pad stack tight">
      <div className="row between">
        <strong><Icon name="sparkle" size={16} /> Telegram</strong>
        {data.linked ? <Badge tone="good">{t('Connected')}{data.username ? ` · @${data.username}` : ''}</Badge> : <Badge tone="muted">{t('Not connected')}</Badge>}
      </div>
      {data.linked ? (
        <>
          <Switch checked={data.notify} label={t('Messages from the bot')} hint={t('Check-in receipts, approvals, payslip ready and a reminder if you forget to check out.')}
            onChange={async (v) => { const r = await run(() => api<TgStatus>('/auth/telegram/notify', { method: 'PUT', body: { notify: v } })); if (r) { setData(r); if (v && mini) requestWriteAccess(); } }} />
          {mini && <p className="faint small" style={{ margin: 0 }}>{t('Telegram signs you in to this app by itself.')}</p>}
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={async () => { const r = await run(() => api<TgStatus>('/auth/telegram/unlink', { method: 'POST' })); if (r) setData(r); }}>{t('Disconnect Telegram')}</button>
        </>
      ) : mini ? (
        <button className="btn primary" disabled={busy} onClick={async () => {
          const r = await run(() => api<TgStatus>('/auth/telegram/link', { body: { initData: telegramInitData() } }));
          if (r) { setData(r); requestWriteAccess(); }
        }}>{t('Connect this Telegram account')}</button>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>{data.botUsername
            ? tx('Get your check-in receipts, approvals and payslips in Telegram from {0}, and open this app from Telegram without signing in.', <b>@{data.botUsername}</b>)
            : t('Get your check-in receipts, approvals and payslips in Telegram, and open this app from Telegram without signing in.')}</p>
          <button className="btn primary" disabled={busy} onClick={async () => {
            const r = await run(() => api<{ url: string }>('/auth/telegram/connect-link', { method: 'POST' }));
            if (r) openTelegramLink(r.url);
          }}>{t('Connect Telegram')}</button>
          <p className="faint small" style={{ margin: 0 }}>{tx('Telegram opens; press {0}. Then come back here.', <b>Start</b>)}</p>
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}
