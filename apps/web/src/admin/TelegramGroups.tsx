import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Badge, Empty, ErrorText, Loading, Modal, Switch, useAction, useConfirm, useLoad, useToast } from '../components/ui';

type GroupEvent = 'check_in' | 'check_out' | 'leave' | 'correction';
interface Group {
  id: string; title: string | null; events: GroupEvent[]; lang: 'km' | 'en' | 'both'; branchId: string | null; branchName: string | null;
  active: boolean; statusNote: string | null; createdAt: string;
}
interface State { available: boolean; botUsername: string | null; groups: Group[] }

const EVENTS: { key: GroupEvent; label: string; hint: string }[] = [
  { key: 'check_in', label: t('Check-ins'), hint: t('Who checked in, when, where, late or on time') },
  { key: 'check_out', label: t('Check-outs'), hint: t('Who checked out, early leave and overtime') },
  { key: 'leave', label: t('Leave requests'), hint: t('New requests, with a button to review them') },
  { key: 'correction', label: t('Fix-scan requests'), hint: t('“Forgot to scan” requests from staff') },
];

/**
 * Settings: the company's Telegram groups. The bot posts check-ins, check-outs, leave and fix-scan requests there.
 * "Connect" opens Telegram, where the admin picks the group; the bot joins and the group shows up here by itself.
 */
export function TelegramGroupsCard() {
  const { data, error, loading, reload, setData } = useLoad(() => api<State>('/telegram-groups'), []);
  const branches = useLoad(() => api<{ id: string; name: string; status: string }[]>('/branches'), []);
  const [connect, setConnect] = useState<{ url: string; command: string; botUsername: string; minutes: number; before: number } | null>(null);
  const { busy, error: actionError, run } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const timer = useRef<number | undefined>(undefined);

  // While the connect window is open, look for the new group every few seconds.
  useEffect(() => {
    if (!connect) return;
    let tries = 0;
    timer.current = window.setInterval(async () => {
      if (++tries > 60) return window.clearInterval(timer.current);
      const s = await api<State>('/telegram-groups').catch(() => null);
      if (s && s.groups.length > connect.before) {
        setData(s);
        setConnect(null);
        toast(t('Telegram group connected'));
      }
    }, 3000);
    return () => window.clearInterval(timer.current);
  }, [connect]);

  if (loading && !data) return <div className="card card-pad"><Loading /></div>;
  if (!data) return <ErrorText error={error} />;

  async function start() {
    const r = await run(() => api<{ url: string; command: string; botUsername: string; minutes: number }>('/telegram-groups/connect-link', { method: 'POST' }));
    if (!r) return;
    setConnect({ ...r, before: data!.groups.length });
    window.open(r.url, '_blank', 'noopener');
  }

  async function save(g: Group, patch: Partial<Pick<Group, 'events' | 'lang' | 'branchId' | 'active'>>) {
    const r = await run(() => api<State>(`/telegram-groups/${g.id}`, { method: 'PUT', body: patch }), t('Saved'));
    if (r) setData(r);
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2><Icon name="send" size={18} /> {t('Telegram groups')}</h2>
        {data.available && <button className="btn primary" disabled={busy} onClick={start}><Icon name="plus" size={16} /> {t('Connect a Telegram group')}</button>}
      </div>
      <div className="card-body stack">
        <p className="muted small" style={{ margin: 0 }}>
          {t("The bot posts to your company's Telegram group when staff check in or out, and when they ask for leave or to fix a scan.")}
          {' '}{t('Connect as many groups as you like, e.g. one for HR and one per branch, and choose what each group gets.')}
        </p>
        {!data.available && <Alert tone="info">{t('Telegram is not set up on this server yet. Please ask MySoft to set up the bot.')}</Alert>}
        <ErrorText error={actionError} />
        {data.groups.length === 0 && data.available && <Empty icon="send">{t('No group connected yet. Press “Connect a Telegram group”.')}</Empty>}
        {data.groups.map((g) => (
          <div key={g.id} className="card card-pad stack" style={{ boxShadow: 'none', gap: 12 }}>
            <div className="row wrap" style={{ gap: 10, justifyContent: 'space-between' }}>
              <div>
                <b>{g.title ?? t('Telegram group')}</b>{' '}
                {g.active ? <Badge tone="good">{t('Active')}</Badge> : <Badge tone="bad">{t('Stopped')}</Badge>}
                <div className="faint small">{g.branchName ? t('Connected {date} · {branch} only', { date: dateTime(g.createdAt), branch: g.branchName }) : t('Connected {date} · all branches', { date: dateTime(g.createdAt) })}</div>
                {!g.active && g.statusNote && <div className="small" style={{ color: 'var(--bad)' }}>{g.statusNote}</div>}
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn sm" disabled={busy || !g.active} onClick={() => run(() => api(`/telegram-groups/${g.id}/test`, { method: 'POST' }), t('Test message sent'))}>{t('Send a test')}</button>
                <button className="btn sm" disabled={busy} onClick={() => save(g, { active: !g.active })}>{g.active ? t('Pause') : t('Resume')}</button>
                <button className="btn sm danger" disabled={busy} onClick={async () => {
                  if ((await confirm({ title: t('Remove {name}?', { name: g.title ?? t('this group') }), message: t('The bot leaves the group and stops posting there.'), confirm: t('Remove'), danger: true })) === false) return;
                  const r = await run(() => api<State>(`/telegram-groups/${g.id}`, { method: 'DELETE' }), t('Group removed'));
                  if (r) setData(r);
                }}>{t('Remove')}</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {EVENTS.map((ev) => {
                const on = g.events.includes(ev.key);
                return (
                  <Switch key={ev.key} checked={on} disabled={busy} label={ev.label} hint={ev.hint}
                    onChange={() => save(g, { events: on ? g.events.filter((x) => x !== ev.key) : [...g.events, ev.key] })} />
                );
              })}
            </div>
            <div className="row wrap" style={{ gap: 14 }}>
              <label className="small muted">{t('Language')}{' '}
                <select className="select" value={g.lang} disabled={busy} onChange={(e) => save(g, { lang: e.target.value as Group['lang'] })} style={{ width: 'auto', marginLeft: 6 }}>
                  <option value="km">ខ្មែរ (Khmer)</option>
                  <option value="en">English</option>
                  <option value="both">{t('Khmer + English')}</option>
                </select>
              </label>
              <label className="small muted">{t('Branch')}{' '}
                <select className="select" value={g.branchId ?? ''} disabled={busy} onChange={(e) => save(g, { branchId: e.target.value || null })} style={{ width: 'auto', marginLeft: 6 }}>
                  <option value="">{t('All branches')}</option>
                  {(branches.data ?? []).filter((b) => b.status === 'active' || b.id === g.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>

      {connect && (
        <Modal title={t('Connect a Telegram group')} onClose={() => { setConnect(null); reload(); }} footer={<button className="btn" onClick={() => { setConnect(null); reload(); }}>{t('Close')}</button>}>
          <div className="stack">
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
              <li>{t('Telegram opens. Choose your group and confirm')} <b>Add @{connect.botUsername}</b>{t('.')} {t('You must be an admin of the group.')}</li>
              <li>{t('The bot posts “✅ This group is now connected…” in the group, and the group appears here.')}</li>
              <li>{t('Nothing happened? Send this message in the group:')}
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <code className="code-box" style={{ flex: 1, margin: 0 }}>{connect.command}</code>
                  <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(connect.command); toast(t('Copied')); }}>{t('Copy')}</button>
                </div>
              </li>
            </ol>
            <div className="row" style={{ gap: 10 }}>
              <a className="btn primary" href={connect.url} target="_blank" rel="noreferrer"><Icon name="send" size={16} /> {t('Open Telegram again')}</a>
              <span className="faint small">{t('Waiting for the group… This code works for {n} minutes.', { n: connect.minutes })}</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
