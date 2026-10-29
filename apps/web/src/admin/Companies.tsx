import { FormEvent, useState } from 'react';
import { api, setCompanyOverride } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Badge, Empty, ErrorText, Field, Loading, Modal, useAction, useConfirm, useLoad, Switch } from '../components/ui';
import { PageHead } from './shared';

interface Company { id: string; name: string; code: string; timezone: string; status: string; createdAt: string; employeeCount: number; branchCount: number }
const STATUS: Record<string, string> = { active: t('active'), suspended: t('suspended') };

/** Super admin: every company on the platform. */
export function Companies() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => (user?.role === 'super_admin' ? api<Company[]>('/companies') : Promise.resolve([])), []);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ company: Company; admin: { email: string; temporaryPassword?: string } } | null>(null);
  const { run, error: actionError } = useAction();
  const confirm = useConfirm();
  if (user?.role !== 'super_admin') return <Alert tone="warn">{t('Only the platform super admin can manage companies.')}</Alert>;

  return (
    <>
      <PageHead title={t('Companies')} sub={t('Each company has its own employees, branches, QR codes, rules and reports.')}>
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> {t('New company')}</button>
      </PageHead>
      <div className="card">
        <ErrorText error={error || actionError} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Company')}</th><th>{t('Code')}</th><th>{t('Time zone')}</th><th className="num">{t('Employees')}</th><th className="num">{t('Branches')}</th><th>{t('Created')}</th><th>{t('Status')}</th><th></th></tr></thead>
              <tbody>
                {data?.length === 0 && <tr><td colSpan={8}><Empty icon="building">{t('No companies yet.')}</Empty></td></tr>}
                {data?.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    <td className="mono">{c.code}</td>
                    <td>{c.timezone}</td>
                    <td className="num">{c.employeeCount}</td>
                    <td className="num">{c.branchCount}</td>
                    <td className="small">{dateTime(c.createdAt)}</td>
                    <td><Badge tone={c.status === 'active' ? 'good' : 'bad'}>{STATUS[c.status] ?? c.status}</Badge></td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => { setCompanyOverride(c.id); location.href = '/admin'; }}>{t('Open')}</button>
                        <button className={`btn sm ${c.status === 'active' ? 'danger' : 'good'}`} onClick={async () => {
                          const next = c.status === 'active' ? 'suspended' : 'active';
                          if (next === 'suspended' && (await confirm({ title: t('Suspend {name}?', { name: c.name }), message: t('Nobody in this company can sign in or scan until it is reactivated.'), confirm: t('Suspend'), danger: true })) === false) return;
                          await run(() => api(`/companies/${c.id}`, { method: 'PUT', body: { status: next } }), next === 'active' ? t('Company reactivated') : t('Company suspended'));
                          reload();
                        }}>{c.status === 'active' ? t('Suspend') : t('Activate')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <NewCompany onClose={() => setAdding(false)} onSaved={(r) => { setAdding(false); setCreated(r); reload(); }} />}
      {created && (
        <Modal title={t('Company created')} onClose={() => setCreated(null)} footer={<button className="btn primary" onClick={() => setCreated(null)}>{t('Done')}</button>}>
          <div className="stack">
            <Alert tone="good">{t('{name} is ready with a default 08:00–17:00 schedule. Share the admin sign-in below.', { name: created.company.name })}</Alert>
            <dl className="kv">
              <dt>{t('Admin address')}</dt><dd>{location.origin}/admin</dd>
              <dt>{t('Email')}</dt><dd className="mono">{created.admin.email}</dd>
              {created.admin.temporaryPassword && (<><dt>{t('Temporary password')}</dt><dd className="mono">{created.admin.temporaryPassword}</dd></>)}
              <dt>{t('Company code')}</dt><dd className="mono">{created.company.code}</dd>
            </dl>
          </div>
        </Modal>
      )}
    </>
  );
}

function NewCompany({ onClose, onSaved }: { onClose: () => void; onSaved: (r: any) => void }) {
  const [f, setF] = useState({ name: '', code: '', timezone: 'Asia/Phnom_Penh', adminName: '', adminEmail: '', free: false });
  const { busy, error, run } = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api('/companies', { body: f }));
    if (r) onSaved(r);
  }
  return (
    <Modal title={t('New company')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" form="co-form" disabled={busy}>{busy ? t('Creating…') : t('Create company')}</button>
      </>
    }>
      <form id="co-form" className="stack" onSubmit={submit}>
        <div className="grid2">
          <Field label={t('Company name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label={t('Company code')} hint={t('Employees type this to sign in.')}><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" /></Field>
          <Field label={t('Admin name')}><input className="input" value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} required /></Field>
          <Field label={t('Admin email')}><input className="input" type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} required /></Field>
        </div>
        <Field label={t('Time zone')}><input className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} required /></Field>
        <Switch checked={f.free} onChange={(v) => setF({ ...f, free: v })} label={t('Free plan (no billing)')} hint={t('Off: the company gets the normal free trial and then pays like a website sign-up.')} />
        <p className="faint small">{t('A temporary password is generated for the admin.')}</p>
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}
