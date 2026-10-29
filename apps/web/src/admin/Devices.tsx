import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { isAdmin, useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Badge, Empty, ErrorText, Loading, useAction, useConfirm, useLoad } from '../components/ui';
import { PageHead } from './shared';

interface Device { id: string; employeeId: string; employeeCode: string; employeeName: string; department: string | null; deviceName: string | null; platform: string | null; status: string; registeredAt: string; approvedAt: string | null; lastUsedAt: string | null }
const TONE: Record<string, string> = { active: 'good', pending: 'warn', rejected: 'bad', revoked: 'muted' };
const STATUS: Record<string, string> = { active: t('Active'), pending: t('Pending'), rejected: t('Rejected'), revoked: t('Removed') };

export function Devices() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [status, setStatus] = useState('pending');
  const { data, error, loading, reload } = useLoad(() => api<Device[]>('/devices', { query: { status: status === 'all' ? undefined : status } }), [status]);
  const { run, error: actionError } = useAction();
  const confirm = useConfirm();

  const act = async (d: Device, action: 'approve' | 'reject' | 'revoke') => {
    {
      const phone = d.deviceName ?? t('This phone');
      const msg = action === 'approve'
        ? t("{phone} becomes {name}'s only phone for attendance. Any other registered phone is removed.", { phone, name: d.employeeName })
        : action === 'reject' ? t('{name} will not be able to scan with {phone}.', { name: d.employeeName, phone: d.deviceName ?? t('this phone') })
        : t('{phone} will no longer be accepted for {name}.', { phone, name: d.employeeName });
      const title = action === 'approve' ? t('Approve phone?') : action === 'reject' ? t('Reject phone?') : t('Remove phone?');
      const button = action === 'approve' ? t('Approve') : action === 'reject' ? t('Reject') : t('Remove');
      if ((await confirm({ title, message: msg, confirm: button, danger: action !== 'approve' })) === false) return;
    }
    await run(() => api(`/devices/${d.id}/${action}`, { method: 'POST' }), action === 'approve' ? t('Phone approved') : action === 'reject' ? t('Phone rejected') : t('Phone removed'));
    reload();
  };

  return (
    <>
      <PageHead title={t('Phones')} sub={t('Each employee scans from one registered phone. New or replacement phones wait here for approval.')} />
      <div className="card">
        <div className="tabs" style={{ padding: '0 8px' }}>
          {[['pending', t('Waiting for approval')], ['active', t('Active')], ['revoked', t('Removed')], ['rejected', t('Rejected')], ['all', t('All')]].map(([k, l]) => (
            <button key={k} className={`tab${status === k ? ' active' : ''}`} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <ErrorText error={error || actionError} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Department')}</th><th>{t('Phone')}</th><th>{t('Status')}</th><th>{t('Registered')}</th><th>{t('Last scan')}</th><th></th></tr></thead>
              <tbody>
                {data?.length === 0 && <tr><td colSpan={7}><Empty icon="phone">{status === 'pending' ? t('No phones waiting for approval.') : t('No phones.')}</Empty></td></tr>}
                {data?.map((d) => (
                  <tr key={d.id}>
                    <td><Link to={`/admin/employees/${d.employeeId}`}><b>{d.employeeName}</b></Link> <span className="faint small">{d.employeeCode}</span></td>
                    <td>{d.department ?? '—'}</td>
                    <td>{d.deviceName ?? t('Phone')} <span className="faint small">{d.platform}</span></td>
                    <td><Badge tone={TONE[d.status]}>{STATUS[d.status] ?? d.status}</Badge></td>
                    <td className="small">{dateTime(d.registeredAt)}</td>
                    <td className="small">{d.lastUsedAt ? dateTime(d.lastUsedAt) : '—'}</td>
                    <td>
                      {admin && (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          {d.status === 'pending' && <button className="btn sm good" onClick={() => act(d, 'approve')}><Icon name="check" size={14} /> {t('Approve')}</button>}
                          {d.status === 'pending' && <button className="btn sm danger" onClick={() => act(d, 'reject')}>{t('Reject')}</button>}
                          {d.status === 'active' && <button className="btn sm danger" onClick={() => act(d, 'revoke')}>{t('Remove')}</button>}
                          {(d.status === 'revoked' || d.status === 'rejected') && <button className="btn sm" onClick={() => act(d, 'approve')}>{t('Re-approve')}</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
