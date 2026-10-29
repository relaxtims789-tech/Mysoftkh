import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download } from '../lib/api';
import { dateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Badge, Empty, ErrorText, Field, Loading, Modal, useAction, useConfirm, useLoad } from '../components/ui';
import { PageHead, Select, useBranches } from './shared';

interface Qr {
  id: string; branchId: string; branchName: string; branchCode: string; branchStatus: string; label: string | null; token: string; url: string;
  status: string; createdAt: string; regeneratedAt: string | null; disabledAt: string | null; scansToday?: number; lastScanAt?: string | null;
}

export function QrCodes() {
  const [params, setParams] = useSearchParams();
  const branchId = params.get('branchId') ?? '';
  const branches = useBranches();
  const { data, error, loading, reload } = useLoad(() => api<Qr[]>('/qr', { query: { branchId } }), [branchId]);
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();
  const { run, error: actionError } = useAction();

  const act = async (q: Qr, action: 'regenerate' | 'disable' | 'enable') => {
    if (action !== 'enable') {
      const ok = await confirm(action === 'regenerate'
        ? { title: t('Regenerate QR code?'), message: <><b>{q.branchName}</b>: {t('A new code is issued. Every printed copy of the current QR stops working immediately, so print and post the new one right away.')}</>, confirm: t('Regenerate'), danger: true }
        : { title: t('Disable QR code?'), message: <><b>{q.branchName}</b>: {t('Scans of this QR will be refused until you enable it again.')}</>, confirm: t('Disable'), danger: true });
      if (ok === false) return;
    }
    await run(() => api(`/qr/${q.id}/${action}`, { method: 'POST' }), action === 'regenerate' ? t('New QR issued. Print it now.') : action === 'disable' ? t('QR disabled') : t('QR enabled'));
    reload();
  };

  return (
    <>
      <PageHead title={t('QR codes')} sub={t('Print one QR per entrance. A QR holds only a random branch token, never employee data.')}>
        <Select value={branchId} onChange={(v) => setParams(v ? { branchId: v } : {})} options={branches} placeholder={t('All branches')} />
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> {t('New QR')}</button>
      </PageHead>
      <ErrorText error={error || actionError} />
      <div className="card">
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Branch')}</th><th>{t('Label')}</th><th>{t('Status')}</th><th className="num">{t('Scans (24h)')}</th><th>{t('Last scan')}</th><th>{t('Issued')}</th><th></th></tr></thead>
              <tbody>
                {data?.length === 0 && <tr><td colSpan={7}><Empty icon="qr">{t('No QR codes yet. Create one for each branch entrance.')}</Empty></td></tr>}
                {data?.map((q) => (
                  <tr key={q.id}>
                    <td><b>{q.branchName}</b> <span className="faint small">{q.branchCode}</span>{q.branchStatus !== 'active' && <> <Badge>{t('branch inactive')}</Badge></>}</td>
                    <td>{q.label ?? '—'}</td>
                    <td><Badge tone={q.status === 'active' ? 'good' : 'muted'} dot>{q.status === 'active' ? t('Active') : t('Disabled')}</Badge></td>
                    <td className="num">{q.scansToday ?? 0}</td>
                    <td className="small">{q.lastScanAt ? dateTime(q.lastScanAt) : '—'}</td>
                    <td className="small">{dateTime(q.regeneratedAt ?? q.createdAt)}{q.regeneratedAt && <div className="faint">{t('regenerated')}</div>}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {q.status === 'active' && <Link className="btn sm" to={`/admin/qr/${q.id}/print`} target="_blank"><Icon name="printer" size={14} /> {t('Print')}</Link>}
                        {q.status === 'active' && <button className="btn sm icon" title={t('Download PNG')} aria-label={t('Download PNG')} onClick={() => run(() => download(`/qr/${q.id}/image.png`))}><Icon name="download" size={14} /></button>}
                        <button className="btn sm icon" title={t('Regenerate')} aria-label={t('Regenerate')} onClick={() => act(q, 'regenerate')}><Icon name="refresh" size={14} /></button>
                        {q.status === 'active'
                          ? <button className="btn sm danger" onClick={() => act(q, 'disable')}>{t('Disable')}</button>
                          : <button className="btn sm good" onClick={() => act(q, 'enable')}>{t('Enable')}</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card card-pad stack tight">
        <h3>{t('How employees scan')}</h3>
        <p className="muted small">
          {t('Employees open the attendance app and tap')} <b>{t('SCAN QR')}</b>{t(", or scan the poster with their phone's camera app, which opens the attendance link directly. The server then checks the QR, their GPS position against the branch radius, their registered phone and the work schedule before anything is recorded. A photo of the poster is useless away from the office because of the GPS check, and useless on another person's phone because of phone binding.")}
        </p>
      </div>
      {adding && <NewQr onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} defaultBranch={branchId} />}
    </>
  );
}

function NewQr({ onClose, onSaved, defaultBranch }: { onClose: () => void; onSaved: () => void; defaultBranch: string }) {
  const branches = useBranches();
  const [branchId, setBranchId] = useState(defaultBranch);
  const [label, setLabel] = useState(t('Main entrance'));
  const { busy, error, run } = useAction();
  return (
    <Modal title={t('New QR code')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={!branchId || busy} onClick={async () => { if (await run(() => api('/qr', { body: { branchId, label: label.trim() || undefined } }), t('QR created'))) onSaved(); }}>{t('Create')}</button>
      </>
    }>
      <div className="stack">
        <Field label={t('Branch')}><Select value={branchId} onChange={setBranchId} options={branches.filter((b) => b.status === 'active')} placeholder={t('Choose a branch')} /></Field>
        <Field label={t('Label')} hint={t('Where it will be posted, e.g. Main entrance, Warehouse gate.')}><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></Field>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
