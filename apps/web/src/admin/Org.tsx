import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { isAdmin, useAuth } from '../lib/auth';
import { longDate } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Badge, Empty, ErrorText, Loading, useAction, useConfirm, useLoad } from '../components/ui';
import { invalidateRefs, Named, PageHead } from './shared';

function NamedList({ kind, title }: { kind: 'departments' | 'positions'; title: string }) {
  const { data, error, loading, reload } = useLoad(() => api<Named[]>(`/${kind}`), [kind]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const { busy, error: saveError, run } = useAction();
  const confirm = useConfirm();
  const done = () => { invalidateRefs(kind); reload(); };

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api(`/${kind}`, { body: { name } }), t('Added'))) { setName(''); done(); }
  }

  return (
    <div className="card">
      <div className="card-head"><h2>{title}</h2><span className="faint small">{data?.length ?? 0}</span></div>
      <form className="row" style={{ padding: 12 }} onSubmit={add}>
        <input className="input" placeholder={kind === 'departments' ? t('New department') : t('New position')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        <button className="btn primary" disabled={busy}><Icon name="plus" size={16} /> {t('Add')}</button>
      </form>
      <div style={{ padding: '0 12px' }}><ErrorText error={saveError || error} /></div>
      {loading && !data ? <Loading /> : (
        <table className="table">
          <tbody>
            {data?.length === 0 && <tr><td><Empty>{t('None yet.')}</Empty></td></tr>}
            {data?.map((d) => (
              <tr key={d.id}>
                <td>
                  {editing?.id === d.id ? (
                    <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/${kind}/${d.id}`, { method: 'PUT', body: { name: editing.name, status: d.status } }), t('Renamed'))) { setEditing(null); done(); } }}>
                      <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                      <button className="btn sm primary">{t('Save')}</button>
                      <button type="button" className="btn sm" onClick={() => setEditing(null)}>{t('Cancel')}</button>
                    </form>
                  ) : (
                    <>{d.name} {d.status !== 'active' && <Badge>{t('inactive')}</Badge>}</>
                  )}
                </td>
                <td className="num faint small">{t('{n} employees', { n: d.employeeCount })}</td>
                <td className="right nowrap">
                  <button className="btn sm ghost icon" title={t('Rename')} aria-label={t('Rename')} onClick={() => setEditing({ id: d.id, name: d.name })}><Icon name="edit" size={14} /></button>
                  <button className="btn sm ghost icon" title={d.status === 'active' ? t('Deactivate') : t('Activate')} aria-label={t('Toggle active')} onClick={async () => { await run(() => api(`/${kind}/${d.id}`, { method: 'PUT', body: { name: d.name, status: d.status === 'active' ? 'inactive' : 'active' } })); done(); }}><Icon name="power" size={14} /></button>
                  <button className="btn sm ghost icon" title={t('Delete')} aria-label={t('Delete')} onClick={async () => {
                    if ((await confirm({ title: t('Delete {name}?', { name: d.name }), message: d.employeeCount ? t('{n} employees will be left without one.', { n: d.employeeCount }) : t('This cannot be undone.'), confirm: t('Delete'), danger: true })) === false) return;
                    await run(() => api(`/${kind}/${d.id}`, { method: 'DELETE' }), t('Deleted'));
                    done();
                  }}><Icon name="trash" size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Organization() {
  return (
    <>
      <PageHead title={t('Departments & positions')} sub={t('Managers see attendance only for the departments assigned to them.')} />
      <div className="grid2" style={{ alignItems: 'start' }}>
        <NamedList kind="departments" title={t('Departments')} />
        <NamedList kind="positions" title={t('Positions')} />
      </div>
    </>
  );
}

export function Holidays() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, loading, reload } = useLoad(() => api<{ id: string; name: string; date: string }[]>('/holidays', { query: { year } }), [year]);
  const [f, setF] = useState({ name: '', date: '' });
  const { busy, error: saveError, run } = useAction();
  const confirm = useConfirm();
  return (
    <>
      <PageHead title={t('Public holidays')} sub={t('Nobody is marked absent on a holiday. Work on a holiday counts as overtime.')}>
        <button className="btn icon" onClick={() => setYear(year - 1)} aria-label={t('Previous year')}><Icon name="left" size={16} /></button>
        <strong style={{ minWidth: 50, textAlign: 'center' }}>{year}</strong>
        <button className="btn icon" onClick={() => setYear(year + 1)} aria-label={t('Next year')}><Icon name="right" size={16} /></button>
      </PageHead>
      <div className="card">
        {admin && (
          <form className="toolbar" style={{ padding: 12 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api('/holidays', { body: f }), t('Holiday added'))) { setF({ name: '', date: '' }); reload(); } }}>
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
            <input className="input" placeholder={t('Holiday name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required style={{ minWidth: 260 }} />
            <button className="btn primary" disabled={busy}><Icon name="plus" size={16} /> {t('Add holiday')}</button>
          </form>
        )}
        <div style={{ padding: '0 12px' }}><ErrorText error={saveError || error} /></div>
        {loading && !data ? <Loading /> : (
          <table className="table">
            <thead><tr><th>{t('Date')}</th><th>{t('Holiday')}</th><th></th></tr></thead>
            <tbody>
              {data?.length === 0 && <tr><td colSpan={3}><Empty icon="sun">{t('No holidays for {year}.', { year })}</Empty></td></tr>}
              {data?.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap">{longDate(h.date)}</td>
                  <td>{h.name}</td>
                  <td className="right">
                    {admin && <button className="btn sm ghost icon" aria-label={t('Delete')} onClick={async () => {
                      if ((await confirm({ title: t('Delete holiday?'), message: t('{name} on {date}', { name: h.name, date: longDate(h.date) }), confirm: t('Delete'), danger: true })) === false) return;
                      await run(() => api(`/holidays/${h.id}`, { method: 'DELETE' }), t('Holiday deleted'));
                      reload();
                    }}><Icon name="trash" size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
