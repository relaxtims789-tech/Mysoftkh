import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { longDate, PUNCH_STATUS, SOURCE_LABEL, time12 } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Avatar, Badge, Empty, ErrorText, Loading, useLoad } from '../components/ui';
import { PageHead, usePolling } from './shared';
import { TrendChart, TrendPoint } from './TrendChart';

interface DashboardData {
  date: string;
  today: string;
  counts: { totalEmployees: number; scheduled: number; present: number; late: number; absent: number; leave: number; notYet: number; checkedOut: number; overtime: number; earlyLeave: number; dayOff: number; holiday: number };
  trend: TrendPoint[];
  departments: { name: string; total: number; present: number; late: number; absent: number }[];
  recent: { id: string; type: string; typeLabel: string; time: string; status: string; distance: number | null; source: string; name: string; employeeCode: string; photo: string | null; branch: string | null }[];
  pending: { devices: number; corrections: number; leave: number; rejected: number; canApprove: boolean };
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function Dashboard() {
  const [date, setDate] = useState('');
  const { data, error, loading, reload } = useLoad(() => api<DashboardData>('/dashboard', { query: { date } }), [date]);
  usePolling(reload, 30000, !date || date === data?.today);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorText error={error} />;
  const c = data.counts;
  const pct = (n: number) => (c.scheduled ? t('{pct}% of scheduled', { pct: Math.round((n / c.scheduled) * 100) }) : '');
  const liveLink = (status: string) => `/admin/live?status=${status}${date ? `&date=${date}` : ''}`;
  const tiles = [
    { label: t('Total employees'), value: c.totalEmployees, sub: t('{n} scheduled today', { n: c.scheduled }), to: liveLink('all'), mark: 'var(--text-3)' },
    { label: t('Present'), value: c.present, sub: pct(c.present), to: liveLink('present'), mark: 'var(--chart-good)' },
    { label: t('Late'), value: c.late, sub: pct(c.late), to: liveLink('late'), mark: 'var(--chart-warn)' },
    { label: t('Absent'), value: c.absent, sub: c.notYet ? t('{n} not in yet', { n: c.notYet }) : pct(c.absent), to: liveLink('absent'), mark: 'var(--chart-bad)' },
    { label: t('Leave'), value: c.leave, sub: t('approved leave'), to: liveLink('leave'), mark: 'var(--chart-info)' },
    { label: t('Checked out'), value: c.checkedOut, sub: c.earlyLeave ? t('{n} left early', { n: c.earlyLeave }) : '', to: liveLink('checked_out'), mark: 'var(--primary)' },
    { label: t('Overtime'), value: c.overtime, sub: t('employees'), to: liveLink('overtime'), mark: 'var(--primary)' },
  ];
  const isToday = data.date === data.today;

  return (
    <>
      <PageHead title={t('Dashboard')} sub={`${longDate(data.date)}${isToday ? ` · ${t('updates every 30 seconds')}` : ''}`}>
        <input type="date" className="input" value={date || data.date} max={data.today} onChange={(e) => setDate(e.target.value)} aria-label={t('Date')} />
        <button className="btn" onClick={reload}><Icon name="refresh" size={16} /> {t('Refresh')}</button>
      </PageHead>

      {(data.pending.devices > 0 || data.pending.corrections > 0 || data.pending.leave > 0) && data.pending.canApprove && (
        <div className="card card-pad row wrap" style={{ gap: 16 }}>
          <Icon name="bell" />
          <strong>{t('Waiting for you:')}</strong>
          {data.pending.devices > 0 && <Link to="/admin/devices">{t(data.pending.devices > 1 ? '{n} phones to approve' : '{n} phone to approve', { n: data.pending.devices })}</Link>}
          {data.pending.corrections > 0 && <Link to="/admin/corrections">{t(data.pending.corrections > 1 ? '{n} corrections' : '{n} correction', { n: data.pending.corrections })}</Link>}
          {data.pending.leave > 0 && <Link to="/admin/leave">{t(data.pending.leave > 1 ? '{n} leave requests' : '{n} leave request', { n: data.pending.leave })}</Link>}
        </div>
      )}

      <div className="kpis">
        {tiles.map((tile) => (
          <Link key={tile.label} to={tile.to} className="card kpi">
            <span className="k-label"><span className="k-mark" style={{ background: tile.mark }} />{tile.label}</span>
            <span className="k-value">{fmt(tile.value)}</span>
            <span className="k-sub">{tile.sub || ' '}</span>
          </Link>
        ))}
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="card-head"><h2>{t('Last 14 days')}</h2><Link to="/admin/reports" className="small">{t('Reports →')}</Link></div>
          <div className="card-body"><TrendChart data={data.trend} /></div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>{t('Latest scans')}</h2>
            {data.pending.rejected > 0 && <Link to="/admin/rejected" className="small" style={{ color: 'var(--bad)' }}>{t('{n} rejected (24h)', { n: data.pending.rejected })}</Link>}
          </div>
          {data.recent.length === 0 ? <Empty icon="clock">{t('No scans yet.')}</Empty> : data.recent.slice(0, 7).map((r) => (
            <div className="feed-item" key={r.id}>
              <Avatar name={r.name} photo={r.photo} />
              <div className="grow">
                <div style={{ fontWeight: 600 }} className="nowrap">{r.name}</div>
                <div className="faint small">{tServer(r.typeLabel)} · {r.branch ?? SOURCE_LABEL[r.source]}{r.distance != null ? ` · ${Math.round(r.distance)} m` : ''}</div>
              </div>
              <div className="right">
                <div style={{ fontWeight: 650 }}>{time12(r.time)}</div>
                <Badge tone={PUNCH_STATUS[r.status]?.tone}>{PUNCH_STATUS[r.status]?.label}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>{t('By department')}</h2><span className="faint small">{isToday ? t('Today') : longDate(data.date)}</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Department')}</th><th className="num">{t('Scheduled')}</th><th className="num">{t('Present')}</th><th className="num">{t('Late')}</th><th className="num">{t('Absent')}</th><th style={{ width: '35%' }}>{t('Attendance')}</th></tr></thead>
            <tbody>
              {data.departments.length === 0 && <tr><td colSpan={6}><Empty>{t('No one scheduled on this day.')}</Empty></td></tr>}
              {data.departments.map((d) => {
                const rate = d.total ? Math.round((d.present / d.total) * 100) : 0;
                return (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td className="num">{d.total}</td>
                    <td className="num">{d.present}</td>
                    <td className="num">{d.late}</td>
                    <td className="num">{d.absent}</td>
                    <td>
                      <div className="bar-cell">
                        <div className="bar-track" title={t('{onTime} on time, {late} late, {absent} absent', { onTime: d.present - d.late, late: d.late, absent: d.absent })}>
                          <i style={{ width: `${((d.present - d.late) / Math.max(d.total, 1)) * 100}%`, background: 'var(--chart-good)' }} />
                          <i style={{ width: `${(d.late / Math.max(d.total, 1)) * 100}%`, background: 'var(--chart-warn)' }} />
                        </div>
                        <span className="small nowrap" style={{ width: 40, textAlign: 'right' }}>{rate}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
