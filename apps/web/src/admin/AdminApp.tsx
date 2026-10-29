import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import './admin.css';
import { api, getCompanyOverride, login, logout, setCompanyOverride } from '../lib/api';
import { isAdmin, ROLE_LABEL, useAuth } from '../lib/auth';
import { lang, t } from '../lib/i18n';
import { Icon, IconName } from '../components/Icon';
import { APP_NAME, BrandLockup } from '../components/Brand';
import { LangSwitch } from '../components/LangSwitch';
import { Alert, Avatar, ErrorText, Field, Loading, useAction } from '../components/ui';
import { ChangePassword, PasswordInput } from '../employee/Login';
import { usePolling } from './shared';
import { Dashboard } from './Dashboard';
import { LiveAttendance } from './Live';
import { Employees } from './Employees';
import { EmployeeDetail } from './EmployeeDetail';
import { Branches } from './Branches';
import { QrCodes } from './QrCodes';
import { QrPrint } from './QrPrint';
import { Schedules } from './Schedules';
import { Holidays, Organization } from './Org';
import { Devices } from './Devices';
import { CorrectionsAdmin, LeaveAdmin } from './Requests';
import { OvertimeAdmin } from './Overtime';
import { PayrollHome, PayrollRunPage } from './Payroll';
import { Reports } from './Reports';
import { RejectedScans } from './Rejected';
import { Users } from './Users';
import { Settings } from './Settings';
import { AuditLog } from './Audit';
import { Companies } from './Companies';
import { BillingPage, STATE, stateText } from './Billing';
import { Payments, PlatformSettings, Subscriptions } from './Platform';
import { Visitors } from './Visitors';
import { Guides } from './Guides';
import { DemoBanner, DemoLoginCard } from '../components/Demo';
import { useDemo } from '../lib/demo';

function StaffLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const demo = useDemo();
  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(() => login({ login: email.trim(), password }));
  }
  return (
    <div className="login-wrap">
      <div className="login-art">
        <BrandLockup size="lg" />
        <div className="stack" style={{ gap: 20 }}>
          <h2>{t("Attendance with a printed QR code and your staff's own phones.")}</h2>
          <ul>
            <li><Icon name="pin" /> {t('GPS geofence at every branch')}</li>
            <li><Icon name="phone" /> {t('One registered phone per employee')}</li>
            <li><Icon name="chart" /> {t('Live dashboard and payroll-ready reports')}</li>
          </ul>
        </div>
        <span style={{ opacity: 0.7, fontSize: 12 }}>{t('No tablets, kiosks or attendance machines needed.')}</span>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <div className="login-form-brand"><BrandLockup size="sm" /></div>
          <div>
            <h1>{t('Admin sign-in')}</h1>
            <p className="muted">{t('For administrators, HR and managers.')}</p>
          </div>
          {demo && <DemoLoginCard demo={demo} kind="admin" onUse={() => { setEmail(demo.adminLogin ?? ''); setPassword(demo.password ?? ''); }} />}
          <Field label={demo ? t('Email, phone number or demo sign-in') : t('Email or phone number')} htmlFor="em">
            <input id="em" className="input lg" type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder={t('name@company.com or 012 345 678')} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label={t('Password')} htmlFor="pw">
            <PasswordInput id="pw" value={password} onChange={setPassword} autoComplete="current-password" />
          </Field>
          <ErrorText error={error} />
          <button className="btn primary lg block" disabled={busy}>{busy ? t('Signing in…') : t('Sign in')}</button>
          <p className="faint small center">{t('Employees: use the')} <a href="/app">{t('attendance app')}</a>{lang === 'km' ? '។' : '.'}</p>
          <div className="center"><LangSwitch /></div>
        </form>
      </div>
    </div>
  );
}

interface NavItem { to: string; label: string; icon: IconName; end?: boolean; count?: number; show?: boolean }

function UserMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!user) return null;
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="user-chip" onClick={() => setOpen(!open)}>
        <Avatar name={user.name} photo={user.employee?.photo} />
        <span className="who hide-sm"><b>{user.name}</b><span>{t(ROLE_LABEL[user.role] ?? '')}</span></span>
      </button>
      {open && (
        <div className="menu">
          {user.employee && <a href="/app"><Icon name="phone" size={16} /> {t('My attendance app')}</a>}
          <a href="/manage"><Icon name="phone" size={16} /> {t('Phone admin app')}</a>
          <a href="/admin/password"><Icon name="key" size={16} /> {t('Change password')}</a>
          <button onClick={() => { setCompanyOverride(null); logout(); }}><Icon name="logout" size={16} /> {t('Sign out')}</button>
        </div>
      )}
    </div>
  );
}

function CompanySwitcher() {
  const [companies, setCompanies] = useState<{ id: string; name: string; code: string }[]>([]);
  useEffect(() => {
    api('/companies').then(setCompanies).catch(() => undefined);
  }, []);
  const current = getCompanyOverride() ?? '';
  return (
    <select
      className="select"
      style={{ width: 'auto', maxWidth: 240 }}
      value={current}
      onChange={(e) => {
        setCompanyOverride(e.target.value || null);
        location.href = e.target.value ? '/admin' : '/admin/companies';
      }}
      aria-label={t('Company')}
    >
      <option value="">{t('All companies (platform)')}</option>
      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

/** Trial ending, payment due or read-only: shown on every admin page. Also the welcome after a website sign-up. */
function BillingBanner() {
  const { user } = useAuth();
  const location = useLocation();
  const [welcome] = useState(() => new URLSearchParams(location.search).get('welcome') === '1');
  const b = user?.company?.billing;
  if (!b || location.pathname === '/admin/billing') return null;
  const canPay = user?.role === 'company_admin' || user?.role === 'super_admin';
  if (welcome) {
    return (
      <Alert tone="good">
        <b>{t('Welcome to MySoft Attendance!')}</b> {b.state === 'trial' ? stateText(b) : ''} {t('Start in 3 steps:')}{' '}
        <a href="/admin/branches">{t('1. add your branch')}</a> · <a href="/admin/qr">{t('2. print its QR code')}</a> · <a href="/admin/employees">{t('3. add your staff')}</a>{lang === 'km' ? '។' : '.'}
        {' '}{t('Staff then open')} <b>{window.location.origin}/app</b> {t('on their phone.')}
        <div style={{ marginTop: 8 }}><a className="btn primary sm" href="/admin/guides"><Icon name="book" size={15} /> {t('Read the guidelines')}</a></div>
      </Alert>
    );
  }
  const show = b.state === 'grace' || b.state === 'expired' || (b.state === 'trial' && (b.daysLeft ?? 99) <= 7) || (b.state === 'active' && (b.daysLeft ?? 99) <= 5);
  if (!show) return null;
  const tone = b.state === 'expired' ? 'bad' : b.state === 'grace' ? 'warn' : 'info';
  return (
    <Alert tone={tone}>
      <b>{STATE[b.state][0]}:</b> {stateText(b)} {canPay ? <a href="/admin/billing">{t('Go to Billing & plan →')}</a> : t('Please tell your company administrator.')}
    </Alert>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState({ devices: 0, corrections: 0, leave: 0, overtime: 0, payments: 0 });
  const location = useLocation();
  const isSuper = user?.role === 'super_admin';
  const hasCompany = !!user?.company;
  const admin = isAdmin(user);

  const loadPending = () => {
    if (isSuper) api<{ pending: number }>('/platform/invoices/pending-count').then((r) => setPending((p) => ({ ...p, payments: r.pending }))).catch(() => undefined);
    if (!hasCompany) return;
    Promise.all([
      api<any[]>('/devices', { query: { status: 'pending' } }).catch(() => []),
      api<any[]>('/corrections', { query: { status: 'pending' } }).catch(() => []),
      api<any[]>('/leave', { query: { status: 'pending' } }).catch(() => []),
      api<{ pending: number }>('/overtime/pending-count').catch(() => ({ pending: 0 })),
    ]).then(([d, c, l, o]) => setPending((p) => ({ ...p, devices: d.length, corrections: c.length, leave: l.length, overtime: o.pending })));
  };
  useEffect(loadPending, [hasCompany, location.pathname]);
  usePolling(loadPending, 60000, hasCompany || isSuper);
  useEffect(() => setOpen(false), [location.pathname]);

  const platformGroup: { title: string; items: NavItem[] }[] = [{ title: t('Platform'), items: [
    { to: '/admin/companies', label: t('Companies'), icon: 'building' },
    { to: '/admin/subscriptions', label: t('Subscriptions'), icon: 'users' },
    { to: '/admin/payments', label: t('Payments'), icon: 'money', count: pending.payments },
    { to: '/admin/visitors', label: t('Website visitors'), icon: 'chart' },
    { to: '/admin/platform', label: t('Plans & settings'), icon: 'settings' },
  ] }];
  const groups: { title: string; items: NavItem[] }[] = hasCompany
    ? [
        { title: t('Overview'), items: [
          { to: '/admin', label: t('Dashboard'), icon: 'chart', end: true },
          { to: '/admin/live', label: t('Live attendance'), icon: 'clock' },
        ] },
        { title: t('People'), items: [
          { to: '/admin/employees', label: t('Employees'), icon: 'users' },
          { to: '/admin/devices', label: t('Phones'), icon: 'phone', count: pending.devices },
          { to: '/admin/users', label: t('Staff accounts'), icon: 'shield', show: admin },
          { to: '/admin/organization', label: t('Departments & positions'), icon: 'layers', show: admin },
        ] },
        { title: t('Workplace'), items: [
          { to: '/admin/branches', label: t('Branches'), icon: 'building' },
          { to: '/admin/qr', label: t('QR codes'), icon: 'qr', show: admin },
          { to: '/admin/schedules', label: t('Work schedules'), icon: 'calendar' },
          { to: '/admin/holidays', label: t('Holidays'), icon: 'sun' },
        ] },
        { title: t('Requests'), items: [
          { to: '/admin/corrections', label: t('Corrections'), icon: 'wrench', count: pending.corrections },
          { to: '/admin/leave', label: t('Leave'), icon: 'leave', count: pending.leave },
          { to: '/admin/overtime', label: t('Overtime'), icon: 'clock', count: pending.overtime },
        ] },
        { title: t('Payroll'), items: [
          { to: '/admin/payroll', label: t('Payroll'), icon: 'money', show: admin },
        ] },
        { title: t('Reports'), items: [
          { to: '/admin/reports', label: t('Reports'), icon: 'file' },
          { to: '/admin/rejected', label: t('Rejected scans'), icon: 'alert' },
        ] },
        { title: t('Administration'), items: [
          { to: '/admin/billing', label: t('Billing & plan'), icon: 'money', show: user?.role === 'company_admin' || isSuper },
          { to: '/admin/settings', label: t('Settings'), icon: 'settings', show: admin },
          { to: '/admin/audit', label: t('Audit log'), icon: 'list', show: admin },
        ] },
        { title: t('Help'), items: [
          { to: '/admin/guides', label: t('Guidelines'), icon: 'book' },
        ] },
        ...(isSuper ? platformGroup : []),
      ]
    : platformGroup;

  return (
    <div className={`a-shell${open ? ' open' : ''}`}>
      <aside className="a-side no-print">
        <div className="a-brand">
          <span className="mark">{user?.company?.logo ? <img src={user.company.logo} alt="" /> : <Icon name="qr" size={20} />}</span>
          <div style={{ minWidth: 0 }}>
            <strong>{user?.company?.name ?? APP_NAME}</strong>
            <span>{user?.company ? t('Code: {code}', { code: user.company.code }) : t('Platform administration')}</span>
          </div>
        </div>
        <nav className="a-nav">
          {groups.map((g) => {
            const items = g.items.filter((i) => i.show !== false);
            if (!items.length) return null;
            return (
              <div key={g.title} style={{ display: 'contents' }}>
                <div className="group">{g.title}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end}>
                    <Icon name={i.icon} size={17} />
                    {i.label}
                    {!!i.count && <span className="count-pill">{i.count}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="a-main">
        <header className="a-top no-print">
          <button className="btn ghost icon menu-btn" onClick={() => setOpen(true)} aria-label={t('Menu')}><Icon name="menu" /></button>
          {isSuper && <CompanySwitcher />}
          <div className="grow" />
          {hasCompany && <NavLink to="/admin/guides" className="btn sm guide-top-btn"><Icon name="book" size={15} /><span className="hide-sm">{t('Guidelines')}</span></NavLink>}
          <LangSwitch />
          <UserMenu />
        </header>
        <main className="a-content">
          <DemoBanner />
          <BillingBanner />
          {children}
        </main>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <StaffLogin />;
  if (user.mustChangePassword || location.pathname === '/admin/password') return <ChangePassword voluntary={!user.mustChangePassword} />;
  if (user.role === 'employee') return <Navigate to="/app" replace />;
  if (location.pathname.startsWith('/admin/qr/') && location.pathname.endsWith('/print')) {
    return <Routes><Route path="qr/:id/print" element={<QrPrint />} /></Routes>;
  }
  if (!user.company) {
    return (
      <Layout>
        <Routes>
          <Route path="companies" element={<Companies />} />
          <Route path="subscriptions" element={<Subscriptions />} />
          <Route path="payments" element={<Payments />} />
          <Route path="platform" element={<PlatformSettings />} />
          <Route path="visitors" element={<Visitors />} />
          <Route path="*" element={<Navigate to="/admin/companies" replace />} />
        </Routes>
      </Layout>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="live" element={<LiveAttendance />} />
        <Route path="employees" element={<Employees />} />
        <Route path="employees/:id" element={<EmployeeDetail />} />
        <Route path="devices" element={<Devices />} />
        <Route path="users" element={<Users />} />
        <Route path="organization" element={<Organization />} />
        <Route path="branches" element={<Branches />} />
        <Route path="qr" element={<QrCodes />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="holidays" element={<Holidays />} />
        <Route path="corrections" element={<CorrectionsAdmin />} />
        <Route path="leave" element={<LeaveAdmin />} />
        <Route path="overtime" element={<OvertimeAdmin />} />
        <Route path="payroll" element={<PayrollHome />} />
        <Route path="payroll/:month" element={<PayrollRunPage />} />
        <Route path="reports" element={<Reports />} />
        <Route path="rejected" element={<RejectedScans />} />
        <Route path="settings" element={<Settings />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="guides" element={<Guides />} />
        <Route path="companies" element={<Companies />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="payments" element={<Payments />} />
        <Route path="platform" element={<PlatformSettings />} />
        {user.role === 'super_admin' && <Route path="visitors" element={<Visitors />} />}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Layout>
  );
}
