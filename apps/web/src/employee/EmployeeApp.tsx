import { ReactNode, useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import './employee.css';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Loading } from '../components/ui';
import { ChangePassword, LoginScreen } from './Login';
import { Home } from './Home';
import { ScanFlow } from './Scan';
import { HistoryScreen, TodayScreen } from './History';
import { LeaveScreen, NewLeaveScreen } from './Leave';
import { CorrectionsScreen } from './Corrections';
import { DeviceScreen, ProfileScreen } from './Profile';
import { PhoneCheckScreen } from './PhoneCheck';
import { PayslipScreen, PayslipsScreen } from './Payslips';
import { isMiniApp, setBackButton } from '../lib/telegram';

export function MobileTop({ title, back = true, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="m-top">
      {back && (
        <button className="btn ghost icon" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/app'))} aria-label={t('Back')}>
          <Icon name="left" />
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </div>
  );
}

function BottomNav() {
  return (
    <nav className="m-nav" aria-label={t('Main')}>
      <div className="m-nav-inner">
        <NavLink to="/app" end><Icon name="home" size={22} />{t('Home')}</NavLink>
        <NavLink to="/app/history"><Icon name="history" size={22} />{t('History')}</NavLink>
        <NavLink to="/app/scan" className="scan" aria-label={t('Scan QR')}><span className="fab"><Icon name="scan" size={26} /></span></NavLink>
        <NavLink to="/app/leave"><Icon name="leave" size={22} />{t('Leave')}</NavLink>
        <NavLink to="/app/profile"><Icon name="user" size={22} />{t('Profile')}</NavLink>
      </div>
    </nav>
  );
}

function Shell({ children, nav = true }: { children: ReactNode; nav?: boolean }) {
  return (
    <div className={`m-shell${nav ? '' : ' no-nav'}`}>
      {children}
      {nav && <BottomNav />}
    </div>
  );
}

const PUNCH_TYPES = ['check_in', 'check_out', 'lunch_out', 'lunch_in'];

function PunchEntry() {
  const { type } = useParams();
  if (!type || !PUNCH_TYPES.includes(type)) return <Navigate to="/app" replace />;
  return <ScanFlow key={type} punchType={type} />;
}

function ScanEntry() {
  const { token } = useParams();
  return <ScanFlow initialToken={token} />;
}

/** The employee phone app (/app/*) and the QR link entry (/scan/:token). */
export function EmployeeApp({ scanEntry }: { scanEntry?: boolean }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isMiniApp()) return;
    const home = location.pathname === '/app' || location.pathname === '/app/';
    setBackButton(home ? null : () => (history.length > 1 ? navigate(-1) : navigate('/app')));
  }, [location.pathname, navigate]);
  if (!ready) return <Loading />;

  if (!user) return <LoginScreen next={location.pathname + location.search} scanToken={scanEntry ? location.pathname.split('/').pop() : undefined} />;
  if (user.mustChangePassword) return <ChangePassword />;
  if (!user.employee) {
    return (
      <div className="auth-page">
        <h1>{t('No employee profile')}</h1>
        <p className="muted">{t('This account ({account}) is a staff account without an employee record, so it cannot record attendance.', { account: user.email || user.username })}</p>
        <a className="btn primary lg" href="/admin">{t('Open the admin dashboard')}</a>
      </div>
    );
  }
  if (scanEntry) return <ScanEntry />;

  return (
    <Routes>
      <Route index element={<Shell><Home /></Shell>} />
      <Route path="scan" element={<ScanFlow />} />
      <Route path="punch/:type" element={<PunchEntry />} />
      <Route path="today" element={<Shell><TodayScreen /></Shell>} />
      <Route path="history" element={<Shell><HistoryScreen /></Shell>} />
      <Route path="leave" element={<Shell><LeaveScreen /></Shell>} />
      <Route path="leave/new" element={<Shell nav={false}><NewLeaveScreen /></Shell>} />
      <Route path="corrections" element={<Shell><CorrectionsScreen /></Shell>} />
      <Route path="profile" element={<Shell><ProfileScreen /></Shell>} />
      <Route path="device" element={<Shell><DeviceScreen /></Shell>} />
      <Route path="check" element={<Shell><PhoneCheckScreen /></Shell>} />
      <Route path="payslips" element={<Shell><PayslipsScreen /></Shell>} />
      <Route path="payslips/:month" element={<Shell><PayslipScreen /></Shell>} />
      <Route path="password" element={<ChangePassword voluntary />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
