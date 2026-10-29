import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { ROLE_LABEL, useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Badge, Empty, ErrorText, Field, Loading, Modal, useAction, useConfirm, useLoad } from '../components/ui';
import { PageHead, useDepartments } from './shared';

interface StaffUser { id: string; name: string; email: string | null; phone: string | null; username: string; role: string; status: string; lastLoginAt: string | null; employeeId: string | null; employeeCode: string | null; departmentIds: string[] }

const STATUS_LABEL: Record<string, string> = { active: t('Active'), disabled: t('Disabled') };
const roleLabel = (role: string) => (ROLE_LABEL[role] ? t(ROLE_LABEL[role]) : '');

export function Users() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<StaffUser[]>('/users'), []);
  const departments = useDepartments();
  const [editing, setEditing] = useState<StaffUser | 'new' | null>(null);
  const [secret, setSecret] = useState<{ signIn: string; password: string } | null>(null);
  const { run, error: actionError } = useAction();
  const confirm = useConfirm();
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? '?';

  return (
    <>
      <PageHead title={t('Staff accounts')} sub={t('Administrators, HR and managers who use this dashboard.')}>
        <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> {t('Add staff')}</button>
      </PageHead>
      <div className="card">
        <ErrorText error={error || actionError} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Name')}</th><th>{t('Sign-in (email / phone)')}</th><th>{t('Role')}</th><th>{t('Sees')}</th><th>{t('Last sign-in')}</th><th>{t('Status')}</th><th></th></tr></thead>
              <tbody>
                {data?.length === 0 && <tr><td colSpan={7}><Empty icon="shield">{t('No staff accounts.')}</Empty></td></tr>}
                {data?.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.name}</b>{u.employeeCode && <span className="faint small"> · {u.employeeCode}</span>}</td>
                    <td>{u.email}{u.email && u.phone && <br />}{u.phone && <span className={u.email ? 'faint small' : ''}>{u.phone}</span>}</td>
                    <td><Badge tone={u.role === 'company_admin' ? 'primary' : 'muted'}>{roleLabel(u.role)}</Badge></td>
                    <td className="small">{u.role === 'manager' ? (u.departmentIds.length ? u.departmentIds.map(deptName).join(', ') : <span style={{ color: 'var(--warn)' }}>{t('No departments')}</span>) : t('Whole company')}</td>
                    <td className="small">{u.lastLoginAt ? dateTime(u.lastLoginAt) : t('Never')}</td>
                    <td><Badge tone={u.status === 'active' ? 'good' : 'muted'}>{STATUS_LABEL[u.status] ?? u.status}</Badge></td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => setEditing(u)}><Icon name="edit" size={14} /> {t('Edit')}</button>
                        {u.id !== user?.id && (
                          <button className="btn sm" onClick={async () => {
                            if ((await confirm({ title: t('Reset password?'), message: t('{name} gets a temporary password and must change it at next sign-in.', { name: u.name }), confirm: t('Reset') })) === false) return;
                            const r = await run(() => api(`/users/${u.id}/reset-password`, { method: 'POST' }));
                            if (r) setSecret({ signIn: [u.email, u.phone].filter(Boolean).join(` ${t('or')} `) || u.username, password: r.temporaryPassword });
                          }}><Icon name="key" size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && (
        <UserForm
          staff={editing === 'new' ? undefined : editing}
          self={editing !== 'new' && editing.id === user?.id}
          onClose={() => setEditing(null)}
          onSaved={(pw) => { setEditing(null); if (pw) setSecret(pw); reload(); }}
        />
      )}
      {secret && (
        <Modal title={t('Sign-in details')} onClose={() => setSecret(null)} footer={<button className="btn primary" onClick={() => setSecret(null)}>{t('Done')}</button>}>
          <div className="stack">
            <Alert tone="info">{t('Share these with the person. The password is shown only once and must be changed at first sign-in.')}</Alert>
            <dl className="kv"><dt>{t('Address')}</dt><dd>{location.origin}/admin</dd><dt>{t('Sign in with')}</dt><dd className="mono">{secret.signIn}</dd><dt>{t('Temporary password')}</dt><dd className="mono">{secret.password}</dd></dl>
          </div>
        </Modal>
      )}
    </>
  );
}

function UserForm({ staff, self, onClose, onSaved }: { staff?: StaffUser; self: boolean; onClose: () => void; onSaved: (secret?: { signIn: string; password: string }) => void }) {
  const departments = useDepartments();
  const [f, setF] = useState({ name: staff?.name ?? '', email: staff?.email ?? '', phone: staff?.phone ?? '', role: staff?.role ?? 'manager', departmentIds: staff?.departmentIds ?? [], status: staff?.status ?? 'active' });
  const { busy, error, run } = useAction();
  const toggle = (id: string) => setF((s) => ({ ...s, departmentIds: s.departmentIds.includes(id) ? s.departmentIds.filter((x) => x !== id) : [...s.departmentIds, id] }));

  const [missing, setMissing] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.email.trim() && !f.phone.trim()) return setMissing(true);
    setMissing(false);
    if (staff) {
      const r = await run(() => api(`/users/${staff.id}`, { method: 'PUT', body: f }), t('Saved'));
      if (r) onSaved();
    } else {
      const r = await run(() => api('/users', { body: { name: f.name, email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, role: f.role, departmentIds: f.departmentIds } }));
      if (r) onSaved(r.temporaryPassword ? { signIn: r.signIn, password: r.temporaryPassword } : undefined);
    }
  }

  return (
    <Modal title={staff ? t('Edit staff account') : t('Add staff account')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" form="user-form" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
      </>
    }>
      <form id="user-form" className="stack" onSubmit={submit}>
        <Field label={t('Name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <div className="grid2">
          <Field label={t('Email')}><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@company.com" autoComplete="off" /></Field>
          <Field label={t('Phone number')}><input className="input" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="012 345 678" autoComplete="off" /></Field>
        </div>
        <div className={missing ? 'alert bad' : 'faint small'} style={missing ? undefined : { marginTop: -6 }}>
          {missing ? t('Enter an email or a phone number (or both).') : t('They can sign in with either the email or the phone number. Fill in one or both.')}
        </div>
        <Field label={t('Role')} hint={t('Admin: everything. HR: employees, attendance, requests, reports. Manager: views their departments and approves their leave.')}>
          <select className="select" value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="company_admin">{t('Company admin')}</option><option value="hr">{t('HR')}</option><option value="manager">{t('Manager')}</option>
            {staff?.employeeId && <option value="employee">{t('Employee only (remove staff access)')}</option>}
          </select>
        </Field>
        {f.role === 'manager' && (
          <div className="field">
            <span className="label">{t('Departments this manager sees')}</span>
            <div className="chips">
              {departments.map((d) => <button type="button" key={d.id} className={`chip${f.departmentIds.includes(d.id) ? ' on' : ''}`} onClick={() => toggle(d.id)}>{d.name}</button>)}
            </div>
          </div>
        )}
        {staff && !self && (
          <label className="check"><input type="checkbox" checked={f.status === 'active'} onChange={(e) => setF({ ...f, status: e.target.checked ? 'active' : 'disabled' })} /> {t('Account active')}</label>
        )}
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}
