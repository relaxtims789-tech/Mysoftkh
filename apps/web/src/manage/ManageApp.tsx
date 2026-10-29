import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import '../employee/employee.css';
import './manage.css';
import { api, getCompanyOverride, login, logout, setCompanyOverride } from '../lib/api';
import { isAdmin, ROLE_LABEL, useAuth } from '../lib/auth';
import { addDays, hm, LEAVE_TYPES, monthRange, shortDate, time12, todayIso } from '../lib/format';
import { isMiniApp, openTelegramLink, requestWriteAccess, setBackButton, telegramInitData } from '../lib/telegram';
import { Icon, IconName } from '../components/Icon';
import { Alert, Avatar, Badge, DayBadge, Empty, ErrorText, Field, Loading, Switch, useAction, useConfirm, useLoad, useToast } from '../components/ui';
import { ChangePassword, PasswordInput } from '../employee/Login';
import { BrandLockup } from '../components/Brand';
import { LangSwitch } from '../components/LangSwitch';
import { KM_DAYS, lang, t, tServer } from '../lib/i18n';

/**
 * Admin Mini App (/manage) for admins, HR and managers, opened from the admin Telegram bot (or a phone browser):
 * today's numbers, live list, one-tap approvals, staff search and history, Telegram alert settings.
 */

interface Dash {
  date: string;
  counts: { scheduled: number; present: number; late: number; absent: number; leave: number; notYet: number; checkedOut: number; overtime: number };
  recent: { id: string; typeLabel: string; time: string; status: string; name: string; employeeCode: string; photo: string | null; branch: string | null }[];
  pending: { devices: number; corrections: number; leave: number; rejected: number; canApprove: boolean };
}

function Top({ title, back, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="m-top">
      {back && !isMiniApp() && <button className="btn ghost icon" onClick={() => navigate(-1)} aria-label={t('Back')}><Icon name="left" /></button>}
      <h1>{title}</h1>
      {right}
    </div>
  );
}

function Shell({ children, pending }: { children: ReactNode; pending: number }) {
  const items: [string, string, IconName, boolean?][] = [
    ['/manage', t('Today'), 'chart', true], ['/manage/live', t('Live'), 'clock'], ['/manage/approvals', t('Approvals'), 'check'], ['/manage/staff', t('Staff'), 'users'], ['/manage/settings', t('More'), 'settings'],
  ];
  return (
    <div className="m-shell">
      {children}
      <nav className="m-nav" aria-label={t('Main')}>
        <div className="m-nav-inner">
          {items.map(([to, label, icon, end]) => (
            <NavLink key={to} to={to} end={end} className="mg-tab">
              <span className="mg-ic"><Icon name={icon} size={22} />{to === '/manage/approvals' && pending > 0 && <span className="mg-count">{pending > 99 ? '99+' : pending}</span>}</span>
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function usePendingTotal() {
  const [n, setN] = useState(0);
  const location = useLocation();
  useEffect(() => {
    Promise.all([
      api<Dash>('/dashboard').catch(() => null),
      api<{ pending: number }>('/overtime/pending-count').catch(() => ({ pending: 0 })),
    ]).then(([d, o]) => setN((d ? d.pending.devices + d.pending.corrections + d.pending.leave : 0) + o.pending));
  }, [location.pathname]);
  return n;
}

// ---------- Today ----------

function TodayScreen() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<Dash>('/dashboard'), []);
  const ot = useLoad(() => api<{ pending: number }>('/overtime/pending-count').catch(() => ({ pending: 0 })), []);
  const navigate = useNavigate();
  const c = data?.counts;
  const tiles: [string, number | undefined, string, string][] = [
    [t('Present'), c?.present, 'good', 'present'], [t('Late'), c?.late, 'warn', 'late'], [t('Absent'), c?.absent, 'bad', 'absent'],
    [t('On leave'), c?.leave, 'info', 'leave'], [t('Not in yet'), c?.notYet, 'muted', 'not_yet'], [t('Checked out'), c?.checkedOut, 'muted', 'checked_out'],
  ];
  const pend = data ? [
    [t('Phones'), data.pending.devices, 'devices'], [t('Leave'), data.pending.leave, 'leave'], [t('Corrections'), data.pending.corrections, 'corrections'], [t('Overtime'), ot.data?.pending ?? 0, 'overtime'],
  ] as [string, number, string][] : [];
  return (
    <>
      <Top title={user?.company?.name ?? t('Today')} right={<button className="btn ghost icon" onClick={() => { reload(); ot.reload(); }} aria-label={t('Refresh')}><Icon name="refresh" /></button>} />
      <div className="m-page">
        {loading && !data && <Loading />}
        <ErrorText error={error} />
        {data && c && (
          <>
            <div className="card card-pad">
              <div className="row between"><strong>{shortDate(data.date)}</strong><span className="faint small">{t('{n} working today', { n: c.scheduled })}</span></div>
              <div className="mg-tiles">
                {tiles.map(([label, n, tone, status]) => (
                  <button key={status} className={`mg-tile ${tone}`} onClick={() => navigate(`/manage/live?status=${status}`)}>
                    <span className="n">{n ?? 0}</span><span className="l">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h2>{t('Waiting for approval')}</h2></div>
              {pend.every(([, n]) => !n) ? <div className="card-body faint small">{t('Nothing to approve.')}</div> : pend.filter(([, n]) => n > 0).map(([label, n, tab]) => (
                <Link key={tab} className="day-row" to={`/manage/approvals?tab=${tab}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="grow">{label}</span><Badge tone="warn">{n}</Badge><Icon name="right" size={16} />
                </Link>
              ))}
              {data.pending.rejected > 0 && (
                <div className="day-row"><Icon name="alert" size={16} /><span className="grow small">{data.pending.rejected === 1 ? t('1 refused scan in the last 24 hours') : t('{n} refused scans in the last 24 hours', { n: data.pending.rejected })}</span></div>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h2>{t('Latest scans')}</h2></div>
              {data.recent.length === 0 && <Empty icon="clock">{t('No scans yet today.')}</Empty>}
              {data.recent.slice(0, 10).map((r) => (
                <div className="day-row" key={r.id}>
                  <Avatar name={r.name} photo={r.photo} />
                  <div className="grow"><b>{r.name}</b><div className="faint small">{tServer(r.typeLabel)} · {r.branch ?? ''}</div></div>
                  <span className="small">{time12(r.time)}</span>
                </div>
              ))}
            </div>
            <a className="btn block" href="/admin"><Icon name="chart" size={16} /> {t('Open the full dashboard')}</a>
          </>
        )}
      </div>
    </>
  );
}

// ---------- Live ----------

interface LiveRow { employeeId: string; employeeCode: string; name: string; photo: string | null; department: string | null; checkIn: string | null; checkOut: string | null; status: string; lateMinutes: number; location: { branch: string | null; distance: number | null } | null }

const LIVE_FILTERS: [string, string][] = [['all', t('All')], ['present', t('Present')], ['late', t('Late')], ['absent', t('Absent')], ['not_yet', t('Not in')], ['leave', t('Leave')], ['checked_out', t('Out')]];

function LiveScreen() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const h = setTimeout(() => setQ(search), 300); return () => clearTimeout(h); }, [search]);
  const { data, error, loading } = useLoad(() => api<{ rows: LiveRow[] }>('/attendance/live', { query: { status, search: q } }), [status, q]);
  const navigate = useNavigate();
  return (
    <>
      <Top title={t('Live attendance')} />
      <div className="m-page">
        <div className="mg-chips">
          {LIVE_FILTERS.map(([k, l]) => <button key={k} className={`chip${status === k ? ' on' : ''}`} onClick={() => setParams(k === 'all' ? {} : { status: k }, { replace: true })}>{l}</button>)}
        </div>
        <input className="input" placeholder={t('Search name or ID')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <ErrorText error={error} />
        {loading && !data ? <Loading /> : (
          <div className="card">
            {data?.rows.length === 0 && <Empty icon="users">{t('Nobody here.')}</Empty>}
            {data?.rows.map((r) => (
              <button key={r.employeeId} className="day-row mg-row" onClick={() => navigate(`/manage/staff/${r.employeeId}`)}>
                <Avatar name={r.name} photo={r.photo} />
                <div className="grow" style={{ textAlign: 'left' }}>
                  <b>{r.name}</b>
                  <div className="faint small">{[r.employeeCode, r.department].filter(Boolean).join(' · ')}</div>
                  {(r.checkIn || r.checkOut) && <div className="small">{time12(r.checkIn)} → {time12(r.checkOut)}{r.location?.branch ? ` · ${r.location.branch}` : ''}</div>}
                </div>
                <div className="stack tight" style={{ alignItems: 'flex-end' }}>
                  <DayBadge status={r.status} />
                  {r.lateMinutes > 0 && <span className="small" style={{ color: 'var(--warn)' }}>{t('{n} min', { n: r.lateMinutes })}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---------- Approvals ----------

function ApprovalsScreen() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'leave';
  const admin = isAdmin(user);
  const tabs: [string, string][] = [['leave', t('Leave')], ['overtime', t('Overtime')], ['devices', t('Phones')], ['corrections', t('Corrections')]];
  return (
    <>
      <Top title={t('Approvals')} />
      <div className="m-page">
        <div className="mg-chips">
          {tabs.map(([k, l]) => <button key={k} className={`chip${tab === k ? ' on' : ''}`} onClick={() => setParams({ tab: k }, { replace: true })}>{l}</button>)}
        </div>
        {tab === 'leave' && <LeaveList />}
        {tab === 'overtime' && <OvertimeList />}
        {tab === 'devices' && <DeviceList canApprove={admin} />}
        {tab === 'corrections' && <CorrectionList canApprove={admin} />}
      </div>
    </>
  );
}

function useDecide(reload: () => void) {
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const decide = async (path: string, decision: 'approve' | 'reject', title: string) => {
    let note: string | false | undefined;
    if (decision === 'reject') {
      note = await confirm({ title, message: t('The employee gets your note in Telegram.'), confirm: t('Reject'), danger: true, input: { label: t('Note (optional)') } });
      if (note === false) return;
    }
    const ok = await run(() => api(`${path}/${decision}`, { body: note ? { note } : {} }), decision === 'approve' ? t('Approved') : t('Rejected'));
    if (ok !== undefined) reload();
  };
  return { busy, error, decide };
}

function Buttons({ busy, onApprove, onReject }: { busy: boolean; onApprove: () => void; onReject: () => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <button className="btn good grow" disabled={busy} onClick={onApprove}><Icon name="check" size={16} /> {t('Approve')}</button>
      <button className="btn danger grow" disabled={busy} onClick={onReject}>{t('Reject')}</button>
    </div>
  );
}

function LeaveList() {
  const { data, error, loading, reload } = useLoad(() => api<any[]>('/leave', { query: { status: 'pending' } }), []);
  const { busy, error: e2, decide } = useDecide(reload);
  if (loading && !data) return <Loading />;
  return (
    <>
      <ErrorText error={error || e2} />
      {data?.length === 0 && <div className="card"><Empty icon="leave">{t('No leave waiting.')}</Empty></div>}
      {data?.map((l) => (
        <div className="card card-pad stack tight" key={l.id}>
          <div className="row between"><b>{l.employeeName}</b><span className="faint small">{l.employeeCode}</span></div>
          <div>{LEAVE_TYPES[l.leaveType] ?? l.leaveType} · {shortDate(l.startDate)}{l.endDate !== l.startDate ? ` – ${shortDate(l.endDate)}` : ''} · {Number(l.days) === 1 ? t('1 day') : t('{n} days', { n: l.days })}</div>
          {l.reason && <div className="muted small">“{l.reason}”</div>}
          <Buttons busy={busy} onApprove={() => decide(`/leave/${l.id}`, 'approve', t('Reject this leave?'))} onReject={() => decide(`/leave/${l.id}`, 'reject', t('Reject this leave?'))} />
        </div>
      ))}
    </>
  );
}

function OvertimeList() {
  const { data, error, loading, reload } = useLoad(() => api<{ policy: { requiresApproval: boolean }; rows: any[] }>('/overtime', { query: { status: 'pending', from: addDays(todayIso(), -62) } }), []);
  const { busy, error: e2, run } = useAction();
  const confirm = useConfirm();
  if (loading && !data) return <Loading />;
  if (data && !data.policy.requiresApproval) return <div className="card"><Empty icon="clock">{t('Overtime approval is off: all overtime counts automatically.')}</Empty></div>;
  const review = async (r: any, decision: 'approve' | 'reject') => {
    let note: string | false = '';
    if (decision === 'reject') {
      note = await confirm({ title: t('Reject overtime?'), message: t('Rejected overtime is not paid.'), confirm: t('Reject'), danger: true, input: { label: t('Note (optional)') } });
      if (note === false) return;
    }
    const ok = await run(() => api('/overtime/review', { body: { items: [{ employeeId: r.employeeId, workDate: r.workDate, decision, note: note || undefined }] } }), decision === 'approve' ? t('Approved') : t('Rejected'));
    if (ok) reload();
  };
  return (
    <>
      <ErrorText error={error || e2} />
      {data?.rows.length === 0 && <div className="card"><Empty icon="clock">{t('No overtime waiting.')}</Empty></div>}
      {data?.rows.map((r) => (
        <div className="card card-pad stack tight" key={`${r.employeeId}|${r.workDate}`}>
          <div className="row between"><b>{r.name}</b><span className="faint small">{r.employeeCode}</span></div>
          <div>{t('{time} overtime', { time: hm(r.overtimeMinutes) })} · {shortDate(r.workDate)} <span className="faint small">({time12(r.checkIn)} → {time12(r.checkOut)})</span></div>
          {r.reason && <div className="muted small">“{r.reason}”</div>}
          <Buttons busy={busy} onApprove={() => review(r, 'approve')} onReject={() => review(r, 'reject')} />
        </div>
      ))}
    </>
  );
}

function DeviceList({ canApprove }: { canApprove: boolean }) {
  const { data, error, loading, reload } = useLoad(() => api<any[]>('/devices', { query: { status: 'pending' } }), []);
  const { busy, error: e2, decide } = useDecide(reload);
  if (loading && !data) return <Loading />;
  return (
    <>
      <ErrorText error={error || e2} />
      {data?.length === 0 && <div className="card"><Empty icon="phone">{t('No phones waiting.')}</Empty></div>}
      {data?.map((d) => (
        <div className="card card-pad stack tight" key={d.id}>
          <div className="row between"><b>{d.employeeName}</b><span className="faint small">{d.employeeCode}</span></div>
          <div>{d.deviceName ?? t('Phone')} <span className="faint small">{d.platform}</span></div>
          {canApprove ? <Buttons busy={busy} onApprove={() => decide(`/devices/${d.id}`, 'approve', t('Reject phone?'))} onReject={() => decide(`/devices/${d.id}`, 'reject', t('Reject phone?'))} /> : <span className="faint small">{t('HR or an admin approves phones.')}</span>}
        </div>
      ))}
    </>
  );
}

function CorrectionList({ canApprove }: { canApprove: boolean }) {
  const { data, error, loading, reload } = useLoad(() => api<any[]>('/corrections', { query: { status: 'pending' } }), []);
  const { busy, error: e2, decide } = useDecide(reload);
  if (loading && !data) return <Loading />;
  return (
    <>
      <ErrorText error={error || e2} />
      {data?.length === 0 && <div className="card"><Empty icon="wrench">{t('No corrections waiting.')}</Empty></div>}
      {data?.map((c) => (
        <div className="card card-pad stack tight" key={c.id}>
          <div className="row between"><b>{c.employeeName}</b><span className="faint small">{c.employeeCode}</span></div>
          <div>{tServer(c.typeLabel)} {time12(c.requestedTime)} · {shortDate(c.workDate)}{c.currentTime ? <span className="faint small"> {t('(was {time})', { time: time12(c.currentTime) })}</span> : ''}</div>
          <div className="muted small">“{c.reason}”</div>
          {canApprove ? <Buttons busy={busy} onApprove={() => decide(`/corrections/${c.id}`, 'approve', t('Reject this correction?'))} onReject={() => decide(`/corrections/${c.id}`, 'reject', t('Reject this correction?'))} /> : <span className="faint small">{t('HR or an admin approves corrections.')}</span>}
        </div>
      ))}
    </>
  );
}

// ---------- Staff ----------

function StaffScreen() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const h = setTimeout(() => setQ(search), 300); return () => clearTimeout(h); }, [search]);
  const { data, error, loading } = useLoad(() => api<{ items: any[]; total: number }>('/employees', { query: { search: q, status: 'active', pageSize: 60 } }), [q]);
  const navigate = useNavigate();
  return (
    <>
      <Top title={t('Staff')} />
      <div className="m-page">
        <input className="input" placeholder={t('Name, ID, phone')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <ErrorText error={error} />
        {loading && !data ? <Loading /> : (
          <div className="card">
            {data?.items.length === 0 && <Empty icon="users">{t('No staff found.')}</Empty>}
            {data?.items.map((e) => (
              <button key={e.id} className="day-row mg-row" onClick={() => navigate(`/manage/staff/${e.id}`)}>
                <Avatar name={e.name} photo={e.profilePhoto} />
                <div className="grow" style={{ textAlign: 'left' }}><b>{e.name}</b><div className="faint small">{[e.employeeCode, e.department, e.position].filter(Boolean).join(' · ')}</div></div>
                <Icon name="right" size={16} />
              </button>
            ))}
            {data && data.total > data.items.length && <div className="card-body faint small">{t('Showing {n} of {total}. Search to find others.', { n: data.items.length, total: data.total })}</div>}
          </div>
        )}
      </div>
    </>
  );
}

function StaffDetail() {
  const { id = '' } = useParams();
  const month = todayIso().slice(0, 7);
  const e = useLoad(() => api<any>(`/employees/${id}`), [id]);
  const h = useLoad(() => api<any>('/attendance/history', { query: { employeeId: id, ...monthRange(month) } }), [id]);
  const emp = e.data;
  return (
    <>
      <Top title={emp?.name ?? t('Employee')} back />
      <div className="m-page">
        <ErrorText error={e.error || h.error} />
        {!emp ? <Loading /> : (
          <div className="card card-pad stack tight" style={{ alignItems: 'center', textAlign: 'center' }}>
            <Avatar name={emp.name} photo={emp.profilePhoto} large />
            <h2 style={{ margin: 0 }}>{emp.name}</h2>
            <div className="muted small">{[emp.employeeCode, emp.position, emp.department, emp.branch].filter(Boolean).join(' · ')}</div>
            <div className="row" style={{ gap: 8 }}>
              {emp.phone && <a className="btn sm" href={`tel:${emp.phone.replace(/[^0-9+]/g, '')}`}><Icon name="phone" size={14} /> {t('Call')}</a>}
              <a className="btn sm" href={`/admin/employees/${emp.id}`}>{t('Full profile')}</a>
            </div>
            {emp.devices?.some((d: any) => d.status === 'pending') && <Badge tone="warn">{t('New phone waiting')}</Badge>}
          </div>
        )}
        {h.data && (
          <>
            <div className="card stats4">
              <div><div className="n" style={{ color: 'var(--good)' }}>{h.data.totals.present}</div><div className="l">{t('Present')}</div></div>
              <div><div className="n" style={{ color: 'var(--warn)' }}>{h.data.totals.late}</div><div className="l">{t('Late')}</div></div>
              <div><div className="n" style={{ color: 'var(--bad)' }}>{h.data.totals.absent}</div><div className="l">{t('Absent')}</div></div>
              <div><div className="n" style={{ color: 'var(--info)' }}>{h.data.totals.leave}</div><div className="l">{t('Leave')}</div></div>
            </div>
            <div className="card">
              {h.data.days.filter((d: any) => d.status !== 'upcoming').reverse().map((d: any) => {
                const cin = d.records.find((r: any) => r.type === 'check_in');
                const outs = d.records.filter((r: any) => r.type === 'check_out');
                return (
                  <div className="day-row" key={d.date}>
                    <div className="day-date"><div className="d">{Number(d.date.slice(8))}</div><div className="w">{lang === 'km' ? KM_DAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()] : new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</div></div>
                    <div className="grow small">{cin || outs.length ? `${time12(cin?.time)} → ${time12(outs[outs.length - 1]?.time)}` : <span className="faint">{d.holiday ?? (d.leaveType ? t('Leave ({type})', { type: LEAVE_TYPES[d.leaveType] ?? d.leaveType }) : '—')}</span>}{d.lateMinutes ? <span style={{ color: 'var(--warn)' }}> · {t('late {n} min', { n: d.lateMinutes })}</span> : ''}</div>
                    <DayBadge status={d.status} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---------- Settings ----------

interface TgStatus { adminAvailable: boolean; adminBotUsername: string | null; linked: boolean; username: string | null; adminNotify: boolean; adminAlerts: string[] }

const ALERTS: [string, string, string][] = [
  ['requests', t('New requests to approve'), t('Phones, leave, corrections and overtime waiting for you.')],
  ['summary', t('Morning summary'), t('Present, late and absent, every working day.')],
  ['late_absent', t('Late and absent'), t('When someone checks in late, and who has not come in.')],
  ['rejected', t('Refused scans'), t('Scans from outside the area, another phone or a wrong QR.')],
];

function SettingsScreen() {
  const { user } = useAuth();
  const tg = useLoad(() => api<TgStatus>('/auth/telegram/status').catch(() => null), []);
  const st = useLoad(() => api<{ time: string }>('/auth/telegram/summary-time').catch(() => null), [user?.company?.id]);
  const [time, setTime] = useState('');
  useEffect(() => { if (st.data) setTime(st.data.time); }, [st.data]);
  const { busy, error, run } = useAction();
  const toast = useToast();
  const canTime = user?.role === 'company_admin' || user?.role === 'super_admin';
  const tgs = tg.data;
  const setAlerts = async (body: object) => {
    const r = await run(() => api<TgStatus>('/auth/telegram/admin-alerts', { method: 'PUT', body }));
    if (r) tg.setData(r);
  };
  return (
    <>
      <Top title={t('More')} />
      <div className="m-page">
        {user?.role === 'super_admin' && <CompanyPicker />}
        <div className="card card-pad stack tight">
          <div className="row between"><b>{user?.name}</b><Badge tone="info">{user ? t(ROLE_LABEL[user.role] ?? user.role) : ''}</Badge></div>
          <span className="faint small">{user?.company?.name}</span>
        </div>
        {tgs?.adminAvailable && (
          <div className="card card-pad stack">
            <div className="row between">
              <strong><Icon name="bell" size={16} /> {t('Telegram alerts')}</strong>
              {tgs.linked ? <Badge tone="good">{tgs.username ? `@${tgs.username}` : t('Connected')}</Badge> : <Badge tone="muted">{t('Not connected')}</Badge>}
            </div>
            {!tgs.linked ? (
              isMiniApp() ? (
                <button className="btn primary" disabled={busy} onClick={async () => { const r = await run(() => api<TgStatus>('/auth/telegram/link', { body: { initData: telegramInitData(), bot: 'admin' } })); if (r) { tg.setData(r); requestWriteAccess(); } }}>{t('Connect this Telegram')}</button>
              ) : (
                <button className="btn primary" disabled={busy} onClick={async () => { const r = await run(() => api<{ url: string }>('/auth/telegram/connect-link', { method: 'POST', query: { bot: 'admin' } })); if (r) openTelegramLink(r.url); }}>{t('Connect @{bot}', { bot: tgs.adminBotUsername })}</button>
              )
            ) : (
              <>
                <Switch checked={tgs.adminNotify} onChange={(v) => setAlerts({ notify: v })} label={t('Alerts from the admin bot')} />
                {tgs.adminNotify && ALERTS.map(([k, label, hint]) => (
                  <Switch key={k} checked={tgs.adminAlerts.includes(k)} label={label} hint={hint}
                    onChange={(v) => setAlerts({ alerts: v ? [...tgs.adminAlerts, k] : tgs.adminAlerts.filter((x) => x !== k) })} />
                ))}
              </>
            )}
          </div>
        )}
        {st.data && (
          <div className="card card-pad stack tight">
            <strong>{t('Morning summary time')}</strong>
            {canTime ? (
              <form className="row" style={{ gap: 8 }} onSubmit={async (e: FormEvent) => { e.preventDefault(); const r = await run(() => api('/auth/telegram/summary-time', { method: 'PUT', body: { time } })); if (r) toast(t('Saved')); }}>
                <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required style={{ maxWidth: 140 }} />
                <button className="btn" disabled={busy}>{t('Save')}</button>
              </form>
            ) : <span>{st.data.time}</span>}
            <span className="faint small">{t('Sent on working days, in the company\'s time zone. The "not checked in yet" list goes out 30 minutes after the late time.')}</span>
          </div>
        )}
        <ErrorText error={error} />
        <div className="card">
          <a className="day-row" href="/admin" style={{ color: 'inherit', textDecoration: 'none' }}><Icon name="chart" /><span className="grow">{t('Full admin dashboard')}</span><Icon name="right" size={16} /></a>
          <a className="day-row" href="/admin/reports" style={{ color: 'inherit', textDecoration: 'none' }}><Icon name="file" /><span className="grow">{t('Reports')}</span><Icon name="right" size={16} /></a>
          {user?.employee && <a className="day-row" href="/app" style={{ color: 'inherit', textDecoration: 'none' }}><Icon name="phone" /><span className="grow">{t('My own attendance')}</span><Icon name="right" size={16} /></a>}
          <div className="day-row"><Icon name="settings" /><span className="grow">Language / ភាសា</span><LangSwitch /></div>
        </div>
        <button className="btn danger block lg" onClick={() => { setCompanyOverride(null); logout(); }}><Icon name="logout" /> {t('Sign out')}</button>
      </div>
    </>
  );
}

function CompanyPicker() {
  const { data } = useLoad(() => api<{ id: string; name: string }[]>('/companies').catch(() => []), []);
  return (
    <div className="card card-pad stack tight">
      <strong>{t('Company')}</strong>
      <select className="select" value={getCompanyOverride() ?? ''} onChange={(e) => { setCompanyOverride(e.target.value || null); location.href = '/manage'; }}>
        <option value="">{t('Choose…')}</option>
        {data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

// ---------- Sign-in ----------

function ManageLogin() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const s = await run(() => login({ login: loginId.trim(), password }));
    if (s && isMiniApp() && telegramInitData() && s.user.role !== 'employee') {
      api('/auth/telegram/link', { body: { initData: telegramInitData(), bot: 'admin' } }).then(() => requestWriteAccess()).catch(() => undefined);
    }
  }
  return (
    <form className="auth-page" onSubmit={submit}>
      <div className="row" style={{ justifyContent: 'flex-end' }}><LangSwitch /></div>
      <BrandLockup center name={t('Attendance admin')} sub={t('For admins, HR and managers')} />
      {isMiniApp() && <Alert tone="info">{t('Sign in once. Next time Telegram signs you in by itself.')}</Alert>}
      <Field label={t('Email or phone number')} htmlFor="mg-l">
        <input id="mg-l" className="input lg" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required />
      </Field>
      <Field label={t('Password')} htmlFor="mg-p"><PasswordInput id="mg-p" value={password} onChange={setPassword} autoComplete="current-password" /></Field>
      <ErrorText error={error} />
      <button className="btn primary lg block" disabled={busy}>{busy ? t('Signing in…') : t('Sign in')}</button>
      <p className="faint small center">{t('Staff record attendance in the staff app.')}</p>
    </form>
  );
}

/** The admin Mini App (/manage/*). */
export default function ManageApp() {
  const { user, ready } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isMiniApp()) return;
    const home = location.pathname === '/manage' || location.pathname === '/manage/';
    setBackButton(home ? null : () => (history.length > 1 ? navigate(-1) : navigate('/manage')));
  }, [location.pathname, navigate]);
  const pending = usePendingTotal();
  if (!ready) return <Loading />;
  if (!user) return <ManageLogin />;
  if (user.mustChangePassword) return <ChangePassword />;
  if (user.role === 'employee') {
    return (
      <div className="auth-page">
        <h1>{t('For admins only')}</h1>
        <p className="muted">{t('This app is for admins, HR and managers. Use the staff app to record your attendance.')}</p>
        <a className="btn primary lg" href="/app">{t('Open the staff app')}</a>
        <button className="btn ghost" onClick={() => logout()}>{t('Sign out')}</button>
      </div>
    );
  }
  if (!user.company) {
    return <Shell pending={0}><Top title={t('Choose a company')} /><div className="m-page"><CompanyPicker /></div></Shell>;
  }
  return (
    <Shell pending={pending}>
      <Routes>
        <Route index element={<TodayScreen />} />
        <Route path="live" element={<LiveScreen />} />
        <Route path="approvals" element={<ApprovalsScreen />} />
        <Route path="staff" element={<StaffScreen />} />
        <Route path="staff/:id" element={<StaffDetail />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/manage" replace />} />
      </Routes>
    </Shell>
  );
}
