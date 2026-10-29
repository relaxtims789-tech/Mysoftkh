import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { deviceStatus, DeviceStatus } from '../lib/device';
import { DAY_STATUS, greeting, longDate, time12 } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, ErrorText, Loading, useLoad } from '../components/ui';
import { InAppWarning, InstallCard } from '../components/PhoneHelp';

export interface TodayData {
  date: string;
  time: string;
  schedule: { startTime: string; endTime: string; lunchStart: string | null; lunchEnd: string | null; lateAfter: string; workDays: number[] } | null;
  summary: {
    status: string; checkIn: string | null; checkOut: string | null; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number;
    workedMinutes: number; flags: string[]; holiday: string | null; leaveType: string | null; isWorkingDay: boolean;
  } | null;
  records: { id: string; type: string; typeLabel: string; time: string; status: string; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number; branchName: string | null; distance: number | null; source: string }[];
  nextType: string;
  nextTypeLabel: string;
  rules: { allowLunchScan: boolean; requireGps: boolean; requireDeviceBinding: boolean; allowEmployeeCorrections: boolean; allowButtonCheckin?: boolean };
}

const STATUS_TEXT: Record<string, { text: string; tone: string }> = {
  present: { text: t('ON TIME'), tone: 'good' },
  late: { text: t('LATE'), tone: 'warn' },
  absent: { text: t('ABSENT'), tone: 'bad' },
  leave: { text: t('ON LEAVE'), tone: 'info' },
  holiday: { text: t('HOLIDAY'), tone: 'muted' },
  day_off: { text: t('DAY OFF'), tone: 'muted' },
  not_yet: { text: t('NOT CHECKED IN'), tone: 'muted' },
};

export function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<TodayData>('/attendance/today'), []);
  const [device, setDevice] = useState<DeviceStatus | null>(null);

  useEffect(() => {
    deviceStatus().then(setDevice).catch(() => setDevice(null));
    const onFocus = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstName = user?.employee?.name.split(' ')[0] ?? user?.name;
  const recordTime = (type: string) => {
    const list = data?.records.filter((r) => r.type === type) ?? [];
    return (type === 'check_out' ? list[list.length - 1] : list[0])?.time ?? null;
  };
  const checkIn = recordTime('check_in');
  const checkOut = recordTime('check_out');
  const s = data?.summary;
  const st = s ? STATUS_TEXT[s.status] ?? { text: DAY_STATUS[s.status]?.label.toUpperCase() ?? '', tone: 'muted' } : null;

  return (
    <>
      <div className="m-hero">
        <div className="row between">
          <div className="company">
            {user?.company?.logo ? <img src={user.company.logo} alt="" /> : <Icon name="building" size={16} />}
            {user?.company?.name}
          </div>
          <button className="btn ghost icon" onClick={reload} aria-label={t('Refresh')}><Icon name="refresh" /></button>
        </div>
        <h1>{greeting(Number(data?.time?.slice(0, 2) ?? new Date().getHours()))}, {firstName}</h1>
        <div className="date">{data ? longDate(data.date) : ' '}</div>
      </div>

      <div className="m-overlap stack">
        {user?.company?.billing?.readOnly && (
          <Alert tone="bad">{t("Your company's subscription has ended, so scanning is paused. Ask your administrator to renew it.")}</Alert>
        )}
        <InAppWarning />
        <div className="card">
          <div className="punch-pair">
            <div>
              <div className="lbl">{t('Check-in')}</div>
              <div className={`val${checkIn ? '' : ' none'}`}>
                {time12(checkIn)} {checkIn && <Icon name="check" size={20} className="ok" />}
              </div>
            </div>
            <div>
              <div className="lbl">{t('Check-out')}</div>
              <div className={`val${checkOut ? '' : ' none'}`}>
                {time12(checkOut)} {checkOut && <Icon name="check" size={20} className="ok" />}
              </div>
            </div>
          </div>
        </div>

        {data?.rules.allowButtonCheckin ? (
          <>
            <div className="punch-btns">
              <button
                className={`punch-btn in${data.nextType === 'check_in' ? ' next' : ''}`}
                disabled={!!checkIn}
                onClick={() => navigate('/app/punch/check_in')}
              >
                <Icon name="logout" size={26} />
                <span>{t('CHECK IN')}</span>
                {checkIn && <small>{t('Done {time}', { time: time12(checkIn) })}</small>}
              </button>
              <button
                className={`punch-btn out${data.nextType === 'check_out' ? ' next' : ''}`}
                onClick={() => navigate('/app/punch/check_out')}
              >
                <Icon name="logout" size={26} />
                <span>{t('CHECK OUT')}</span>
                {checkOut && <small>{t('Last {time}', { time: time12(checkOut) })}</small>}
              </button>
            </div>
            {data.rules.allowLunchScan && (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn block" disabled={!checkIn || !!recordTime('lunch_out')} onClick={() => navigate('/app/punch/lunch_out')}>{t('Lunch out')}</button>
                <button className="btn block" disabled={!recordTime('lunch_out') || !!recordTime('lunch_in')} onClick={() => navigate('/app/punch/lunch_in')}>{t('Lunch in')}</button>
              </div>
            )}
            <button className="btn block" onClick={() => navigate('/app/scan')}><Icon name="scan" size={18} /> {t('Scan QR instead')}</button>
            <div className="center faint small" style={{ marginTop: -6 }}>{t('Your location is checked when you tap. You must be at the office.')}</div>
          </>
        ) : (
          <>
            <button className="scan-btn" onClick={() => navigate('/app/scan')}>
              <Icon name="scan" size={26} /> {t('SCAN QR')}
            </button>
            {data && <div className="center faint small" style={{ marginTop: -6 }}>{t('Next scan:')} <b>{tServer(data.nextTypeLabel)}</b></div>}
          </>
        )}

        {device && device.bindingRequired && device.device?.status !== 'active' && (
          <Alert tone="warn">
            {device.device?.status === 'pending' ? tServer(device.message) : t('This phone is not registered yet. It will be registered when you scan, or') + ' '}
            {!device.device && <Link to="/app/device">{t('register it now')}</Link>}
          </Alert>
        )}

        {loading && !data && <Loading />}
        <ErrorText error={error} />

        {data && (
          <div className="card card-pad stack">
            <div className="status-line">
              <span className="muted" style={{ fontWeight: 600 }}>{t("Today's status")}</span>
              {s?.flags.includes('early_leave') && <span className="badge warn">{t('Early leave')}</span>}
              {s && s.overtimeMinutes > 0 && <span className="badge info">{t('Overtime {n} min', { n: s.overtimeMinutes })}</span>}
            </div>
            {st && <div className={`status-big ${st.tone}`}>{st.text}{s && s.lateMinutes > 0 ? ` · ${t('{n} min', { n: s.lateMinutes })}` : ''}</div>}
            {s?.holiday && <div className="muted">{s.holiday}</div>}
            {data.schedule && (
              <div className="row small muted wrap">
                <Icon name="clock" size={15} />
                {t('Work hours {start} – {end} · late after {late}', { start: time12(data.schedule.startTime), end: time12(data.schedule.endTime), late: time12(data.schedule.lateAfter) })}
              </div>
            )}
          </div>
        )}

        <div className="tiles">
          <Link className="tile" to="/app/today"><span className="ic"><Icon name="clock" /></span>{t('Today')}</Link>
          <Link className="tile" to="/app/history"><span className="ic"><Icon name="calendar" /></span>{t('History')}</Link>
          <Link className="tile" to="/app/leave/new"><span className="ic"><Icon name="leave" /></span>{t('Request leave')}</Link>
          <Link className="tile" to="/app/corrections"><span className="ic"><Icon name="wrench" /></span>{t('Fix a scan')}</Link>
          <Link className="tile" to="/app/payslips"><span className="ic"><Icon name="money" /></span>{t('Payslips')}</Link>
        </div>
        <InstallCard compact />
        <Link to="/app/check" className="center small" style={{ marginTop: -4 }}>{t('Problems scanning? Check my phone')}</Link>
      </div>
    </>
  );
}
