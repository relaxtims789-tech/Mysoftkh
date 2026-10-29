import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download } from '../lib/api';
import { FLAG_LABEL, hm, LEAVE_TYPES, longDate, SOURCE_LABEL, time12 } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Avatar, DayBadge, Empty, ErrorText, Loading, useLoad } from '../components/ui';
import { mapLink, PageHead, Select, useBranches, useDepartments, usePolling } from './shared';

interface LiveRow {
  employeeId: string; employeeCode: string; name: string; photo: string | null; department: string | null; branch: string | null;
  checkIn: string | null; lunchOut: string | null; lunchIn: string | null; checkOut: string | null; status: string; flags: string[];
  lateMinutes: number; earlyMinutes: number; overtimeMinutes: number; workedMinutes: number;
  location: { branch: string | null; distance: number | null; latitude: number | null; longitude: number | null; source: string } | null;
  leaveType: string | null; holiday: string | null;
}
interface LiveData { date: string; counts: Record<string, number>; rows: LiveRow[] }

const TABS: [string, string, string][] = [
  ['all', t('All'), 'total'], ['present', t('Present'), 'present'], ['late', t('Late'), 'late'], ['absent', t('Absent'), 'absent'],
  ['not_yet', t('Not yet in'), 'notYet'], ['leave', t('Leave'), 'leave'], ['checked_out', t('Checked out'), 'checkedOut'],
  ['early_leave', t('Early leave'), 'earlyLeave'], ['overtime', t('Overtime'), 'overtime'],
];

export function LiveAttendance() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'all';
  const date = params.get('date') || '';
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const branches = useBranches();
  const departments = useDepartments();
  const { data, error, loading, reload } = useLoad(
    () => api<LiveData>('/attendance/live', { query: { date, branchId, departmentId, search: search.trim(), status } }),
    [date, branchId, departmentId, status, search],
  );
  usePolling(reload, 20000, !date);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  return (
    <>
      <PageHead title={t('Live attendance')} sub={data ? `${longDate(data.date)}${!date ? ` · ${t('refreshes every 20 seconds')}` : ''}` : ''}>
        <input type="date" className="input" value={date || data?.date || ''} onChange={(e) => set('date', e.target.value)} aria-label={t('Date')} />
        <button className="btn" onClick={() => download('/reports/export', { type: 'daily', format: 'xlsx', date: date || data?.date, branchId, departmentId })}>
          <Icon name="download" size={16} /> Excel
        </button>
      </PageHead>

      <div className="card">
        <div className="tabs" style={{ padding: '0 8px' }}>
          {TABS.map(([key, label, countKey]) => (
            <button key={key} className={`tab${status === key ? ' active' : ''}`} onClick={() => set('status', key === 'all' ? '' : key)}>
              {label} {data && <span className="n">{data.counts[countKey] ?? 0}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar" style={{ padding: 12 }}>
          <div className="search"><Icon name="search" size={16} /><input className="input" placeholder={t('Search name or ID')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Select value={branchId} onChange={setBranchId} options={branches} placeholder={t('All branches')} />
          <Select value={departmentId} onChange={setDepartmentId} options={departments} placeholder={t('All departments')} />
        </div>
        <ErrorText error={error} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{t('Employee')}</th><th>{t('Department')}</th><th>{t('Branch')}</th><th>{t('Check-in')}</th><th>{t('Check-out')}</th><th className="num">{t('Worked')}</th><th>{t('Status')}</th><th>{t('Location')}</th></tr>
              </thead>
              <tbody>
                {data?.rows.length === 0 && <tr><td colSpan={8}><Empty icon="users">{t('No employees match.')}</Empty></td></tr>}
                {data?.rows.map((r) => {
                  const link = mapLink(r.location?.latitude, r.location?.longitude);
                  return (
                    <tr key={r.employeeId}>
                      <td>
                        <Link to={`/admin/employees/${r.employeeId}`} className="row" style={{ color: 'inherit' }}>
                          <Avatar name={r.name} photo={r.photo} />
                          <span><span style={{ fontWeight: 600 }}>{r.name}</span><br /><span className="faint small">{r.employeeCode}</span></span>
                        </Link>
                      </td>
                      <td>{r.department ?? '—'}</td>
                      <td>{r.branch ?? '—'}</td>
                      <td className="nowrap">
                        {time12(r.checkIn)}
                        {r.lateMinutes > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{t('+{n} min', { n: r.lateMinutes })}</div>}
                      </td>
                      <td className="nowrap">
                        {time12(r.checkOut)}
                        {r.earlyMinutes > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{t('−{n} min', { n: r.earlyMinutes })}</div>}
                        {r.overtimeMinutes > 0 && <div className="small" style={{ color: 'var(--info)' }}>{t('OT {n} min', { n: r.overtimeMinutes })}</div>}
                      </td>
                      <td className="num">{hm(r.workedMinutes)}</td>
                      <td>
                        <DayBadge status={r.status} />
                        {r.flags.filter((f) => f !== 'overtime' && f !== 'early_leave').map((f) => <div key={f} className="small faint">{FLAG_LABEL[f]}</div>)}
                        {r.leaveType && <div className="small faint">{LEAVE_TYPES[r.leaveType]}</div>}
                      </td>
                      <td className="small">
                        {r.location ? (
                          <>
                            {r.location.branch ?? SOURCE_LABEL[r.location.source]}
                            {r.location.distance != null && <span className="faint"> · {Math.round(r.location.distance)} m</span>}
                            {link && <> · <a href={link} target="_blank" rel="noreferrer">{t('map')}</a></>}
                          </>
                        ) : <span className="faint">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
