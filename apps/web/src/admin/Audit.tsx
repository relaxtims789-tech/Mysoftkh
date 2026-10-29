import { Fragment, useState } from 'react';
import { api } from '../lib/api';
import { dateTime, todayIso, addDays } from '../lib/format';
import { ROLE_LABEL } from '../lib/auth';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Empty, ErrorText, Loading, Pager, useLoad } from '../components/ui';
import { PageHead } from './shared';

const MODULES = ['auth', 'employees', 'attendance', 'attendance_corrections', 'leave_requests', 'devices', 'qr_codes', 'branches', 'work_schedules', 'holidays', 'attendance_rules', 'companies', 'users', 'departments', 'positions', 'integration_keys', 'integrations'];

/** Module and action names are stored as snake_case (e.g. attendance_corrections, reset_password); shown with spaces. */
const words = (s: string) => t(s.replace(/_/g, ' '));

interface Entry { id: number; createdAt: string; action: string; module: string; recordId: string | null; oldValue: unknown; newValue: unknown; ip: string | null; userName: string | null; userRole: string | null }

export function AuditLog() {
  const [q, setQ] = useState({ module: '', from: addDays(todayIso(), -30), to: todayIso(), page: 1 });
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading } = useLoad(() => api<{ items: Entry[]; total: number; page: number; pageSize: number }>('/audit-logs', { query: { ...q, pageSize: 50 } }), [q]);
  return (
    <>
      <PageHead title={t('Audit log')} sub={t('Every change: who, what, when and from where.')}>
        <select className="select" value={q.module} onChange={(e) => setQ({ ...q, module: e.target.value, page: 1 })}>
          <option value="">{t('All modules')}</option>
          {MODULES.map((m) => <option key={m} value={m}>{words(m)}</option>)}
        </select>
        <input type="date" className="input" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value, page: 1 })} aria-label={t('From')} />
        <input type="date" className="input" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value, page: 1 })} aria-label={t('To')} />
      </PageHead>
      <div className="card">
        <ErrorText error={error} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('When')}</th><th>{t('User')}</th><th>{t('Module')}</th><th>{t('Action')}</th><th>{t('Record')}</th><th>IP</th><th></th></tr></thead>
              <tbody>
                {data?.items.length === 0 && <tr><td colSpan={7}><Empty icon="list">{t('Nothing logged in this period.')}</Empty></td></tr>}
                {data?.items.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="clickable" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="nowrap small">{dateTime(e.createdAt)}</td>
                      <td>{e.userName ?? <span className="faint">{t('System')}</span>} {e.userRole && <span className="faint small">{ROLE_LABEL[e.userRole] ? t(ROLE_LABEL[e.userRole]) : ''}</span>}</td>
                      <td>{words(e.module)}</td>
                      <td><b>{words(e.action)}</b></td>
                      <td className="mono faint">{e.recordId?.slice(0, 8) ?? ''}</td>
                      <td className="mono small">{e.ip ?? ''}</td>
                      <td><Icon name={open === e.id ? 'left' : 'right'} size={14} /></td>
                    </tr>
                    {open === e.id && (
                      <tr>
                        <td colSpan={7}>
                          <div className="grid2">
                            <div><div className="label">{t('Before')}</div><pre className="json">{JSON.stringify(e.oldValue, null, 2) ?? '—'}</pre></div>
                            <div><div className="label">{t('After')}</div><pre className="json">{JSON.stringify(e.newValue, null, 2) ?? '—'}</pre></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ ...q, page: p })} />}
      </div>
    </>
  );
}
