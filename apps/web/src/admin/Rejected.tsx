import { useState } from 'react';
import { api } from '../lib/api';
import { addDays, dateTime, todayIso } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Badge, Empty, ErrorText, Loading, Pager, useLoad } from '../components/ui';
import { mapLink, PageHead } from './shared';

const REASONS: Record<string, string> = {
  OUTSIDE_GEOFENCE: t('Outside area'), GPS_INACCURATE: t('Weak GPS'), GPS_REQUIRED: t('No GPS'), INVALID_QR: t('Invalid QR'), QR_DISABLED: t('Disabled QR'),
  DEVICE_NOT_REGISTERED: t('Unknown phone'), DEVICE_PENDING: t('Phone pending'), DEVICE_NOT_ALLOWED: t('Phone not allowed'), DEVICE_REQUIRED: t('No phone key'),
  BAD_DEVICE_SIGNATURE: t('Bad signature'), BAD_CHALLENGE: t('Expired/replayed'), WRONG_BRANCH: t('Wrong branch'), DUPLICATE_SCAN: t('Duplicate'),
  ALREADY_CHECKED_IN: t('Already in'), EMPLOYEE_INACTIVE: t('Inactive'), BRANCH_INACTIVE: t('Branch inactive'), BUTTON_CHECKIN_DISABLED: t('Button off'),
};
const SECURITY = new Set(['OUTSIDE_GEOFENCE', 'DEVICE_NOT_REGISTERED', 'DEVICE_NOT_ALLOWED', 'BAD_DEVICE_SIGNATURE', 'BAD_CHALLENGE', 'INVALID_QR']);

interface Attempt { id: string; createdAt: string; reasonCode: string; message: string; type: string | null; latitude: number | null; longitude: number | null; gpsAccuracy: number | null; distance: number | null; ip: string | null; employeeCode: string | null; employeeName: string | null; branchName: string | null }

/** Every refused scan. None of these count as attendance. */
export function RejectedScans() {
  const [q, setQ] = useState({ from: addDays(todayIso(), -7), to: todayIso(), reason: '', page: 1 });
  const { data, error, loading } = useLoad(() => api<{ items: Attempt[]; total: number; page: number; pageSize: number }>('/attendance/attempts', { query: { ...q, pageSize: 50 } }), [q]);
  return (
    <>
      <PageHead title={t('Rejected scans')} sub={t('Scans refused by the security checks. They are never recorded as attendance.')}>
        <input type="date" className="input" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value, page: 1 })} aria-label={t('From')} />
        <input type="date" className="input" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value, page: 1 })} aria-label={t('To')} />
        <select className="select" value={q.reason} onChange={(e) => setQ({ ...q, reason: e.target.value, page: 1 })}>
          <option value="">{t('All reasons')}</option>
          {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </PageHead>
      <div className="card">
        <ErrorText error={error} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('When')}</th><th>{t('Employee')}</th><th>{t('Branch')}</th><th>{t('Reason')}</th><th className="num">{t('Distance')}</th><th className="num">GPS ±</th><th>{t('Location')}</th><th>IP</th></tr></thead>
              <tbody>
                {data?.items.length === 0 && <tr><td colSpan={8}><Empty icon="shield">{t('No rejected scans in this period.')}</Empty></td></tr>}
                {data?.items.map((a) => {
                  const link = mapLink(a.latitude, a.longitude);
                  return (
                    <tr key={a.id}>
                      <td className="nowrap small">{dateTime(a.createdAt)}</td>
                      <td>{a.employeeName ?? '—'} <span className="faint small">{a.employeeCode}</span></td>
                      <td>{a.branchName ?? '—'}</td>
                      <td><Badge tone={SECURITY.has(a.reasonCode) ? 'bad' : 'warn'}>{REASONS[a.reasonCode] ?? a.reasonCode}</Badge><div className="faint small" style={{ maxWidth: 280 }}>{tServer(a.message)}</div></td>
                      <td className="num">{a.distance != null ? `${Math.round(a.distance)} m` : ''}</td>
                      <td className="num">{a.gpsAccuracy != null ? `${Math.round(a.gpsAccuracy)} m` : ''}</td>
                      <td className="small">{link ? <a href={link} target="_blank" rel="noreferrer">{t('map')}</a> : '—'}</td>
                      <td className="small mono">{a.ip ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ ...q, page: p })} />}
      </div>
    </>
  );
}
