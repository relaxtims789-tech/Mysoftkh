import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, apiBlob, Billing as BillingState, setCompanyOverride } from '../lib/api';
import { addDays, dateTime, shortDate, todayIso } from '../lib/format';
import { lang, t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Badge, Empty, ErrorText, Field, Loading, Modal, Switch, useAction, useConfirm, useLoad } from '../components/ui';
import { PageHead } from './shared';
import { Invoice, INVOICE_STATUS, METHOD, STATE, usd } from './Billing';

interface Tier { id?: string; minStaff: number; maxStaff: number; monthlyPrice: number; maxBranches?: number | null; active?: boolean }
interface Sub {
  id: string; name: string; code: string; status: string; createdAt: string; source: 'admin' | 'website';
  contactName: string | null; contactPhone: string | null; contactEmail: string | null; note: string | null;
  exempt: boolean; trialEndsAt: string | null; paidUntil: string | null; staffCount: number;
  branchCount: number; branchLimit: number | null; branchLimitCustom: boolean; customBranchLimit: number | null;
  tier: { id: string; minStaff: number; maxStaff: number; monthlyPrice: number; maxBranches: number | null } | null; billing: BillingState; toCheck: number; lastPaidAt: string | null;
}
interface Settings {
  trialMonths: number; graceDays: number; yearlyFreeMonths: number;
  abaAccountName: string | null; abaAccountNumber: string | null; abaQr: string | null;
  acledaAccountName: string | null; acledaAccountNumber: string | null; acledaQr: string | null;
  paywayEnabled: boolean; paywaySandbox: boolean; paywayMerchantId: string | null; paywayApiKeySet: boolean; paywayReady: boolean; paywayCallbackUrl: string;
  salesPhone: string | null; salesTelegram: string | null; salesEmail: string | null; salesTelegramQr: string | null; defaultTelegramQr: string; telegramBotTokenSet: boolean; telegramChatId: string | null;
  telegramBotUsername: string | null; telegramSetupAt: string | null; appUrl: string;
  telegramAdminBotTokenSet: boolean; telegramAdminBotUsername: string | null; telegramAdminSetupAt: string | null; manageUrl: string;
}

const addMonths = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/** Super admin: every customer company with its trial / paid dates. */
export function Subscriptions() {
  const { data, error, loading, reload } = useLoad(() => api<Sub[]>('/platform/subscriptions'), []);
  const tiers = useLoad(() => api<(Tier & { id: string })[]>('/platform/tiers'), []);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [adjust, setAdjust] = useState<Sub | null>(null);
  const [record, setRecord] = useState<Sub | null>(null);
  const list = (data ?? []).filter((s) => (filter === 'all' || s.billing.state === filter || (filter === 'website' && s.source === 'website'))
    && (!search.trim() || `${s.name} ${s.code} ${s.contactPhone ?? ''} ${s.contactEmail ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const counts = (data ?? []).reduce((m, s) => ({ ...m, [s.billing.state]: (m[s.billing.state] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <>
      <PageHead title={t('Subscriptions')} sub={t('Customer companies, free trials and paid periods. Adjust a trial or record a payment here.')} />
      <div className="kpis">
        {(['trial', 'active', 'grace', 'expired', 'exempt'] as const).map((k) => (
          <button key={k} className="card kpi" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', outline: filter === k ? '2px solid var(--primary)' : undefined }} onClick={() => setFilter(filter === k ? 'all' : k)}>
            <span className="k-label">{STATE[k][0]}</span><span className="k-value">{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="card">
        <div className="toolbar" style={{ padding: 12 }}>
          <div className="search"><Icon name="search" size={16} /><input className="input" placeholder={t('Company, code, phone, email')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">{t('All companies')}</option><option value="website">{t('Signed up on the website')}</option>
            {Object.entries(STATE).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <ErrorText error={error} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Company')}</th><th>{t('Contact')}</th><th>{t('Plan')}</th><th>{t('State')}</th><th>{t('Trial ends')}</th><th>{t('Paid until')}</th><th></th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={7}><Empty icon="building">{t('No companies.')}</Empty></td></tr>}
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b> {s.source === 'website' && <Badge tone="info">{t('website')}</Badge>} {s.status !== 'active' && <Badge tone="bad">{t('suspended')}</Badge>}
                      <div className="faint small mono">{s.code} · {t('since {date}', { date: shortDate(s.createdAt.slice(0, 10)) })}</div>
                    </td>
                    <td className="small">{s.contactName ?? ''}<div className="faint">{[s.contactPhone, s.contactEmail].filter(Boolean).join(' · ')}</div></td>
                    <td className="small">{s.tier ? `${t('{min}–{max} staff', { min: s.tier.minStaff, max: s.tier.maxStaff })} · ${usd(s.tier.monthlyPrice)}` : '—'}<div className="faint">{t('{n} active staff', { n: s.staffCount })} · {s.branchLimit == null
                      ? t(s.branchCount === 1 ? '{n} branch' : '{n} branches', { n: s.branchCount })
                      : t(s.branchLimit === 1 ? '{n} of {limit} branch' : '{n} of {limit} branches', { n: s.branchCount, limit: s.branchLimit })}{s.branchLimitCustom ? ` ${t('(custom)')}` : ''}</div></td>
                    <td><Badge tone={STATE[s.billing.state][1]}>{STATE[s.billing.state][0]}</Badge>{s.toCheck > 0 && <div><Badge tone="warn">{t('{n} receipt to check', { n: s.toCheck })}</Badge></div>}</td>
                    <td className="nowrap small">{s.trialEndsAt ? shortDate(s.trialEndsAt) : '—'}</td>
                    <td className="nowrap small">{s.paidUntil ? shortDate(s.paidUntil) : '—'}{s.lastPaidAt && <div className="faint">{t('last paid {date}', { date: shortDate(s.lastPaidAt.slice(0, 10)) })}</div>}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => setAdjust(s)}><Icon name="edit" size={14} /> {t('Adjust')}</button>
                        {!s.exempt && <button className="btn sm" onClick={() => setRecord(s)}><Icon name="money" size={14} /> {t('Record payment')}</button>}
                        <button className="btn sm ghost" onClick={() => { setCompanyOverride(s.id); location.href = '/admin'; }}>{t('Open')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adjust && <AdjustModal sub={adjust} tiers={tiers.data ?? []} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); reload(); }} />}
      {record && <RecordModal sub={record} tiers={(tiers.data ?? []).filter((x) => x.active !== false)} onClose={() => setRecord(null)} onSaved={() => { setRecord(null); reload(); }} />}
    </>
  );
}

function AdjustModal({ sub, tiers, onClose, onSaved }: { sub: Sub; tiers: (Tier & { id: string })[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ exempt: sub.exempt, trialEndsAt: sub.trialEndsAt ?? '', paidUntil: sub.paidUntil ?? '', tierId: sub.tier?.id ?? '', note: sub.note ?? '',
    branchMode: (sub.branchLimitCustom ? (sub.customBranchLimit == null ? 'unlimited' : 'custom') : 'plan') as 'plan' | 'custom' | 'unlimited',
    branches: String(sub.customBranchLimit ?? Math.max(sub.branchCount, sub.tier?.maxBranches ?? 1)) });
  const planTier = tiers.find((x) => x.id === f.tierId);
  const { busy, error, run } = useAction();
  const base = (d: string) => (d && d >= todayIso() ? d : addDays(todayIso(), -1));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api(`/platform/companies/${sub.id}/billing`, {
      method: 'PUT', body: {
        exempt: f.exempt, trialEndsAt: f.trialEndsAt || null, paidUntil: f.paidUntil || null, tierId: f.tierId || null, note: f.note || null,
        branchLimitCustom: f.branchMode !== 'plan', branchLimit: f.branchMode === 'custom' ? Number(f.branches) : null,
      },
    }), t('Saved'));
    if (ok) onSaved();
  }
  return (
    <Modal title={t('Adjust {name}', { name: sub.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" form="adj-form" disabled={busy}>{t('Save')}</button></>}>
      <form id="adj-form" className="stack" onSubmit={submit}>
        <Switch checked={f.exempt} onChange={(v) => setF({ ...f, exempt: v })} label={t('Free plan (never pays)')} hint={t('For your own companies, partners or special offers. No trial end, no staff limit.')} />
        {!f.exempt && (
          <>
            <Field label={t('Free trial until')} hint={t('Offer a longer trial here (e.g. 3 months).')}>
              <div className="row wrap" style={{ gap: 6 }}>
                <input className="input" type="date" style={{ width: 170 }} value={f.trialEndsAt} onChange={(e) => setF({ ...f, trialEndsAt: e.target.value })} />
                {[1, 2, 3].map((n) => <button key={n} type="button" className="btn sm" onClick={() => setF({ ...f, trialEndsAt: addDays(addMonths(base(f.trialEndsAt), n), 0) })}>{t(n > 1 ? '+{n} months' : '+{n} month', { n })}</button>)}
              </div>
            </Field>
            <Field label={t('Paid until')} hint={t('Normally set by payments; change it only to correct a mistake or give extra time.')}>
              <div className="row wrap" style={{ gap: 6 }}>
                <input className="input" type="date" style={{ width: 170 }} value={f.paidUntil} onChange={(e) => setF({ ...f, paidUntil: e.target.value })} />
                <button type="button" className="btn sm" onClick={() => setF({ ...f, paidUntil: addMonths(base(f.paidUntil), 1) })}>{t('+{n} month', { n: 1 })}</button>
                {f.paidUntil && <button type="button" className="btn sm ghost" onClick={() => setF({ ...f, paidUntil: '' })}>{t('Clear')}</button>}
              </div>
            </Field>
            <Field label={t('Plan (staff limit)')}>
              <select className="select" value={f.tierId} onChange={(e) => setF({ ...f, tierId: e.target.value })}>
                <option value="">{t('No limit')}</option>
                {tiers.filter((x) => x.active !== false || x.id === f.tierId).map((x) => <option key={x.id} value={x.id}>{t('{min}–{max} staff · {price}/month', { min: x.minStaff, max: x.maxStaff, price: usd(x.monthlyPrice) })}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label={t('Branches allowed')} hint={`${t('Active now: {n}.', { n: sub.branchCount })} ${f.branchMode === 'plan' ? (f.exempt || !planTier ? t('Free plan / no plan: no limit.') : planTier.maxBranches == null ? t('The plan allows unlimited.') : t('The plan allows {n}.', { n: planTier.maxBranches })) : t('Overrides the plan for this company only.')}`}>
          <div className="row wrap" style={{ gap: 6 }}>
            <select className="select" style={{ width: 'auto' }} value={f.branchMode} onChange={(e) => setF({ ...f, branchMode: e.target.value as typeof f.branchMode })}>
              <option value="plan">{t('As the plan allows')}</option>
              <option value="custom">{t('Custom number')}</option>
              <option value="unlimited">{t('Unlimited')}</option>
            </select>
            {f.branchMode === 'custom' && <input className="input" type="number" min={0} max={100000} style={{ width: 110 }} value={f.branches} onChange={(e) => setF({ ...f, branches: e.target.value })} required />}
          </div>
        </Field>
        <Field label={t('Note (only you see it)')}><input className="input" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t('e.g. Promotion: 3 months free')} /></Field>
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}

function RecordModal({ sub, tiers, onClose, onSaved }: { sub: Sub; tiers: (Tier & { id: string })[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ tierId: sub.tier?.id ?? tiers[0]?.id ?? '', cycle: 'monthly' as 'monthly' | 'yearly', amount: '', note: '' });
  const { busy, error, run } = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api(`/platform/companies/${sub.id}/payments`, { body: { tierId: f.tierId, cycle: f.cycle, amount: f.amount ? Number(f.amount) : undefined, note: f.note || undefined } }), t('Payment recorded'));
    if (ok) onSaved();
  }
  return (
    <Modal title={t('Record a payment · {name}', { name: sub.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" form="rec-form" disabled={busy}>{t('Record payment')}</button></>}>
      <form id="rec-form" className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>{t('For money received outside the app (cash, another bank). The paid period is extended at once.')}</p>
        <div className="grid2">
          <Field label={t('Plan')}><select className="select" value={f.tierId} onChange={(e) => setF({ ...f, tierId: e.target.value })}>{tiers.map((x) => <option key={x.id} value={x.id}>{t('{min}–{max} staff', { min: x.minStaff, max: x.maxStaff })}</option>)}</select></Field>
          <Field label={t('Period')}><select className="select" value={f.cycle} onChange={(e) => setF({ ...f, cycle: e.target.value as 'monthly' | 'yearly' })}><option value="monthly">{t('{n} month', { n: 1 })}</option><option value="yearly">{t('{n} months', { n: 12 })}</option></select></Field>
          <Field label={t('Amount received (USD)')} hint={t('Empty = the list price.')}><input className="input" type="number" min={0} step={0.01} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label={t('Note')}><input className="input" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t('e.g. Cash at office')} /></Field>
        </div>
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}

/** Super admin: bank transfer receipts to approve, and every invoice. */
export function Payments() {
  const [status, setStatus] = useState('submitted');
  const { data, error, loading, reload } = useLoad(() => api<Invoice[]>('/platform/invoices', { query: { status } }), [status]);
  const [view, setView] = useState<{ inv: Invoice; url: string; pdf: boolean } | null>(null);
  const { busy, run, error: actionError } = useAction();
  const confirm = useConfirm();
  useEffect(() => () => { if (view) URL.revokeObjectURL(view.url); }, [view]);

  const showReceipt = async (inv: Invoice) => {
    const blob = await run(() => apiBlob(`/billing/invoices/${inv.id}/receipt`));
    if (blob) setView({ inv, url: URL.createObjectURL(blob), pdf: blob.type === 'application/pdf' });
  };
  const approve = async (inv: Invoice) => {
    const note = await confirm({ title: t('Approve {number}?', { number: inv.number }), message: <>{t('Confirm that')} <b>{usd(inv.amount)}</b> {t('from')} <b>{inv.companyName}</b> {t('arrived in your {bank} account. Their plan is extended at once.', { bank: inv.bank?.toUpperCase() ?? '' })}</>, confirm: t('Approve payment'), input: { label: t('Note (optional)') } });
    if (note === false) return;
    await run(() => api(`/platform/invoices/${inv.id}/approve`, { body: { note: note || undefined } }), t('Payment approved'));
    setView(null);
    reload();
  };
  const reject = async (inv: Invoice) => {
    const note = await confirm({ title: t('Reject {number}?', { number: inv.number }), message: t('The customer sees your reason and can send the receipt again.'), confirm: t('Reject'), danger: true, input: { label: t('Reason'), placeholder: t('e.g. Amount does not match'), required: true } });
    if (!note) return;
    await run(() => api(`/platform/invoices/${inv.id}/reject`, { body: { note } }), t('Receipt rejected'));
    setView(null);
    reload();
  };

  return (
    <>
      <PageHead title={t('Payments')} sub={t('Check bank transfer receipts against your ABA / ACLEDA statement, then approve. ABA PayWay payments are confirmed automatically.')} />
      <div className="card">
        <div className="tabs" style={{ padding: '0 8px' }}>
          {[['submitted', t('To check')], ['unpaid', t('Waiting for payment')], ['paid', t('Paid')], ['rejected', t('Rejected')], ['all', t('All')]].map(([k, l]) => (
            <button key={k} className={`tab${status === k ? ' active' : ''}`} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <ErrorText error={error || actionError} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Invoice')}</th><th>{t('Company')}</th><th>{t('Plan')}</th><th className="num">{t('Amount')}</th><th>{t('Method')}</th><th>{t('Status')}</th><th></th></tr></thead>
              <tbody>
                {data?.length === 0 && <tr><td colSpan={7}><Empty icon="money">{status === 'submitted' ? t('No receipts to check.') : t('No invoices.')}</Empty></td></tr>}
                {data?.map((i) => (
                  <tr key={i.id}>
                    <td><b className="mono">{i.number}</b><div className="faint small">{dateTime(i.createdAt)}</div></td>
                    <td><b>{i.companyName}</b><div className="faint small mono">{i.companyCode}</div></td>
                    <td className="small">{t('{min}–{max} staff', { min: i.minStaff, max: i.maxStaff })} · {i.kind === 'upgrade' ? t('upgrade') : t(i.months > 1 ? '{n} months' : '{n} month', { n: i.months })}</td>
                    <td className="num"><b>{usd(i.amount)}</b></td>
                    <td className="small">{i.method ? METHOD[i.method] : '—'}{i.bank ? ` · ${i.bank.toUpperCase()}` : ''}{i.payerNote && <div className="faint">“{i.payerNote}”</div>}{i.policyVersion && <div className="faint" title={i.policyAcceptedAt ? dateTime(i.policyAcceptedAt) : undefined}>{i.policyAcceptedBy ? t('Refund policy v{version} accepted by {name}', { version: i.policyVersion, name: i.policyAcceptedBy }) : t('Refund policy v{version} accepted', { version: i.policyVersion })}</div>}</td>
                    <td><Badge tone={INVOICE_STATUS[i.status][1]}>{INVOICE_STATUS[i.status][0]}</Badge>{i.paidAt && <div className="faint small">{dateTime(i.paidAt)}{i.reviewedBy ? ` · ${i.reviewedBy}` : ''}</div>}{i.reviewNote && <div className="faint small">{i.reviewNote}</div>}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {i.hasReceipt && <button className="btn sm" onClick={() => showReceipt(i)}><Icon name="eye" size={14} /> {t('Receipt')}</button>}
                        {i.status === 'submitted' && <button className="btn sm good" disabled={busy} onClick={() => approve(i)}>{t('Approve')}</button>}
                        {i.status === 'submitted' && <button className="btn sm danger" disabled={busy} onClick={() => reject(i)}>{t('Reject')}</button>}
                        {i.status === 'unpaid' && i.method === 'payway' && (
                          <button className="btn sm" disabled={busy} onClick={async () => { await run(() => api(`/platform/invoices/${i.id}/check`, { method: 'POST' })); reload(); }}>{t('Check PayWay')}</button>
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
      {view && (
        <Modal title={t('Receipt · {number} · {amount}', { number: view.inv.number, amount: usd(view.inv.amount) })} onClose={() => setView(null)} wide footer={
          view.inv.status === 'submitted' ? <><button className="btn danger" onClick={() => reject(view.inv)}>{t('Reject')}</button><button className="btn good" onClick={() => approve(view.inv)}>{t('Approve')}</button></> : <button className="btn" onClick={() => setView(null)}>{t('Close')}</button>
        }>
          {view.pdf ? <iframe src={view.url} title={t('Receipt')} style={{ width: '100%', height: '70vh', border: 0 }} /> : <img src={view.url} alt={t('Receipt')} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />}
        </Modal>
      )}
    </>
  );
}

/** Super admin: prices, trial length, how customers pay, where alerts go. */
export function PlatformSettings() {
  const s = useLoad(() => api<Settings>('/platform/settings'), []);
  const tl = useLoad(() => api<(Tier & { id: string })[]>('/platform/tiers'), []);
  const [f, setF] = useState<Settings | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [secrets, setSecrets] = useState({ paywayApiKey: '', telegramBotToken: '', telegramAdminBotToken: '' });
  const reloadSettings = async () => {
    const st = await api<Settings>('/platform/settings').catch(() => null);
    if (st) { setF(st); s.setData(st); }
  };
  const { busy, error, run } = useAction();
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  useEffect(() => { if (tl.data) setTiers(tl.data.filter((x) => x.active !== false)); }, [tl.data]);
  if (!f) return <Loading />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });
  const text = (k: keyof Settings, placeholder = '') => (
    <input className="input" value={(f[k] as string | null) ?? ''} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
  );

  async function save() {
    const body: Record<string, unknown> = {
      trialMonths: f!.trialMonths, graceDays: f!.graceDays, yearlyFreeMonths: f!.yearlyFreeMonths,
      abaAccountName: f!.abaAccountName ?? '', abaAccountNumber: f!.abaAccountNumber ?? '', acledaAccountName: f!.acledaAccountName ?? '', acledaAccountNumber: f!.acledaAccountNumber ?? '',
      paywayEnabled: f!.paywayEnabled, paywaySandbox: f!.paywaySandbox, paywayMerchantId: f!.paywayMerchantId ?? '',
      salesPhone: f!.salesPhone ?? '', salesTelegram: f!.salesTelegram ?? '', salesEmail: f!.salesEmail ?? '', telegramChatId: f!.telegramChatId ?? '',
    };
    if (secrets.paywayApiKey) body.paywayApiKey = secrets.paywayApiKey;
    if (secrets.telegramBotToken) body.telegramBotToken = secrets.telegramBotToken;
    if (secrets.telegramAdminBotToken) body.telegramAdminBotToken = secrets.telegramAdminBotToken;
    const r = await run(() => api<Settings>('/platform/settings', { method: 'PUT', body }));
    if (!r) return;
    const tr = await run(() => api<(Tier & { id: string })[]>('/platform/tiers', { method: 'PUT', body: { tiers: tiers.map((x) => ({ id: x.id, minStaff: x.minStaff, maxStaff: x.maxStaff, monthlyPrice: x.monthlyPrice, maxBranches: x.maxBranches ?? null })) } }), t('Settings saved'));
    if (tr) {
      setF(r);
      s.setData(r);
      tl.setData(tr);
      setSecrets({ paywayApiKey: '', telegramBotToken: '', telegramAdminBotToken: '' });
    }
  }

  const uploadQr = async (bank: 'aba' | 'acleda' | 'telegram', file: File | null) => {
    const form = new FormData();
    if (file) form.append('file', file);
    const r = await run(() => api<Settings>(`/platform/settings/qr/${bank}`, { form }), file ? t('QR image saved') : bank === 'telegram' ? t('Back to the built-in Telegram QR') : t('KHQR image removed'));
    if (r) { setF({ ...f, abaQr: r.abaQr, acledaQr: r.acledaQr, salesTelegramQr: r.salesTelegramQr }); s.setData(r); }
  };

  return (
    <>
      <PageHead title={t('Plans & settings')} sub={t('What customers see on the website and in Billing.')} />
      <Alert tone="info">{t('The starting prices are examples. Set your own before telling customers about the website.')}</Alert>
      <div className="card">
        <div className="card-head"><h2>{t('Free trial and billing')}</h2></div>
        <div className="card-body grid3">
          <Field label={t('Free trial for new sign-ups')} hint={t('Give a single company more in Subscriptions → Adjust.')}>
            <select className="select" value={f.trialMonths} onChange={(e) => set('trialMonths', Number(e.target.value))}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{t(n > 1 ? '{n} months' : '{n} month', { n })}</option>)}
            </select>
          </Field>
          <Field label={t('Grace days after the end')} hint={t('Then the account becomes read-only.')}><input className="input" type="number" min={0} max={60} value={f.graceDays} onChange={(e) => set('graceDays', Number(e.target.value))} /></Field>
          <Field label={t('Free months when paying yearly')} hint={t('2 = pay 10 months, get 12.')}><input className="input" type="number" min={0} max={11} value={f.yearlyFreeMonths} onChange={(e) => set('yearlyFreeMonths', Number(e.target.value))} /></Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>{t('Prices (USD per month)')}</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('From staff')}</th><th>{t('To staff')}</th><th className="num">{t('Monthly price')}</th><th className="num">{t('Branches')}</th><th className="num">{t('Yearly price')}</th><th /></tr></thead>
            <tbody>
              {tiers.map((x, i) => (
                <tr key={x.id ?? `new${i}`}>
                  <td><input className="input" type="number" min={1} style={{ width: 110, height: 32 }} value={x.minStaff} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, minStaff: Number(e.target.value) } : y)))} /></td>
                  <td><input className="input" type="number" min={1} style={{ width: 110, height: 32 }} value={x.maxStaff} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, maxStaff: Number(e.target.value) } : y)))} /></td>
                  <td className="num"><input className="input" type="number" min={0} step={0.01} style={{ width: 120, height: 32, textAlign: 'right' }} value={x.monthlyPrice} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, monthlyPrice: Number(e.target.value) } : y)))} /></td>
                  <td className="num"><input className="input" type="number" min={1} placeholder={t('Unlimited')} style={{ width: 110, height: 32, textAlign: 'right' }} value={x.maxBranches ?? ''} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, maxBranches: e.target.value === '' ? null : Number(e.target.value) } : y)))} /></td>
                  <td className="num faint">{usd(x.monthlyPrice * (12 - f.yearlyFreeMonths))}</td>
                  <td><button className="btn ghost icon sm" aria-label={t('Remove')} onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body row">
          <button className="btn sm" onClick={() => { const last = tiers[tiers.length - 1]; setTiers([...tiers, { minStaff: (last?.maxStaff ?? 0) + 1, maxStaff: (last?.maxStaff ?? 0) + 500, monthlyPrice: last?.monthlyPrice ?? 0 }]); }}><Icon name="plus" size={14} /> {t('Add range')}</button>
          <span className="faint small">{t('Branches: empty = unlimited. A removed range stays for customers already on it, hidden from new ones.')}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>{t('Bank transfer accounts')}</h2></div>
        <div className="card-body grid2" style={{ alignItems: 'start' }}>
          {(['aba', 'acleda'] as const).map((b) => (
            <div key={b} className="stack tight">
              <strong>{b === 'aba' ? 'ABA Bank' : 'ACLEDA Bank'}</strong>
              <Field label={t('Account name')}>{text(b === 'aba' ? 'abaAccountName' : 'acledaAccountName', 'MYSOFT KH CO., LTD')}</Field>
              <Field label={t('Account number')}>{text(b === 'aba' ? 'abaAccountNumber' : 'acledaAccountNumber', '000 000 000')}</Field>
              <Field label={t('KHQR image (from your bank app)')}>
                <div className="row wrap" style={{ gap: 10 }}>
                  {(b === 'aba' ? f.abaQr : f.acledaQr) && <img src={(b === 'aba' ? f.abaQr : f.acledaQr)!} alt="KHQR" style={{ width: 90, borderRadius: 8, border: '1px solid var(--border)' }} />}
                  <label className="btn sm"><Icon name="upload" size={14} /> {t('Upload')}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadQr(b, e.target.files?.[0] ?? null)} /></label>
                  {(b === 'aba' ? f.abaQr : f.acledaQr) && <button className="btn sm ghost" onClick={() => uploadQr(b, null)}>{t('Remove')}</button>}
                </div>
              </Field>
            </div>
          ))}
        </div>
        <p className="card-body faint small" style={{ margin: 0 }}>{t('Leave an account empty to hide it. Customers upload a receipt; you approve it in Payments.')}</p>
      </div>

      <div className="card">
        <div className="card-head"><h2>{t('ABA PayWay (online payment)')}</h2>{f.paywayReady ? <Badge tone="good">{t('Ready')}</Badge> : <Badge tone="muted">{t('Off')}</Badge>}</div>
        <div className="card-body stack">
          <p className="muted" style={{ margin: 0 }}>{t('Customers pay by KHQR (any Cambodian bank app), ABA Pay or card, and the plan is extended automatically. Get a merchant account from ABA (paywaysales@ababank.com); test with the sandbox keys first.')}</p>
          <Switch checked={f.paywayEnabled} onChange={(v) => set('paywayEnabled', v)} label={t('Offer ABA PayWay')} />
          <Switch checked={f.paywaySandbox} onChange={(v) => set('paywaySandbox', v)} label={t('Sandbox (test mode)')} hint={t('Turn off with your production merchant ID and API key.')} />
          <div className="grid2">
            <Field label={t('Merchant ID')}>{text('paywayMerchantId')}</Field>
            <Field label={t('API key')} hint={f.paywayApiKeySet ? t('Saved. Type a new one to replace it.') : t('Not set.')}>
              <input className="input" type="password" autoComplete="off" value={secrets.paywayApiKey} onChange={(e) => setSecrets({ ...secrets, paywayApiKey: e.target.value })} placeholder={f.paywayApiKeySet ? '••••••••' : ''} />
            </Field>
          </div>
          <Field label={t('Pushback (return) URL to give ABA')}><input className="input mono" readOnly value={f.paywayCallbackUrl} onFocus={(e) => e.target.select()} /></Field>
          <div><button className="btn sm" disabled={busy} onClick={async () => { const r = await run(() => api<{ ok: boolean; message: string }>('/platform/settings/payway-test', { method: 'POST' })); if (r) alert(tServer(r.message)); }}>{t('Test the saved merchant ID and key')}</button></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>{t('Contact on the website')}</h2></div>
        <div className="card-body grid3">
          <Field label={t('Sales phone')}>{text('salesPhone', '012 345 678')}</Field>
          <Field label="Telegram" hint={t('@username or t.me link')}>{text('salesTelegram', '@mysoftkh')}</Field>
          <Field label={t('Email')}>{text('salesEmail', 'sales@mysoftkh.com')}</Field>
        </div>
        <div className="card-body">
          <Field label={t('Telegram QR on the website')} hint={f.salesTelegramQr ? t('Your uploaded QR is shown.') : t('The built-in @MYSOFTKH QR is shown. Upload another to replace it.')}>
            <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
              <img src={f.salesTelegramQr ?? f.defaultTelegramQr} alt="Telegram QR" style={{ width: 110, borderRadius: 10, border: '1px solid var(--border)', background: '#fff' }} />
              <label className="btn sm"><Icon name="upload" size={14} /> {t('Upload')}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadQr('telegram', e.target.files?.[0] ?? null)} /></label>
              {f.salesTelegramQr && <button className="btn sm ghost" onClick={() => uploadQr('telegram', null)}>{t('Use the built-in QR')}</button>}
            </div>
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>{t('Telegram alerts for you')}</h2>{f.telegramBotTokenSet && f.telegramChatId ? <Badge tone="good">{t('On')}</Badge> : <Badge tone="muted">{t('Off')}</Badge>}</div>
        <div className="card-body stack">
          <p className="muted" style={{ margin: 0 }}>{t('Get a message on each new sign-up, each receipt to check and each payment. Create a bot with @BotFather, send it a message, then put your chat ID here.')}</p>
          <div className="grid2">
            <Field label={t('Bot token')} hint={f.telegramBotTokenSet ? t('Saved. Type a new one to replace it.') : t('Not set.')}>
              <input className="input" type="password" autoComplete="off" value={secrets.telegramBotToken} onChange={(e) => setSecrets({ ...secrets, telegramBotToken: e.target.value })} placeholder={f.telegramBotTokenSet ? '••••••••' : '123456:ABC…'} />
            </Field>
            <Field label={t('Chat ID')}>{text('telegramChatId', '123456789')}</Field>
          </div>
          <div><button className="btn sm" disabled={busy} onClick={() => run(() => api('/platform/settings/telegram-test', { method: 'POST' }), t('Test message sent'))}>{t('Send a test message')}</button></div>
        </div>
      </div>

      <TelegramBotCard
        bot="staff" title={t('Staff bot · Attendance Mini App')} username={f.telegramBotUsername} setupAt={f.telegramSetupAt} tokenSet={f.telegramBotTokenSet} appUrl={f.appUrl}
        about={<>{t('Staff of every company open the attendance app from this bot')} ({lang === 'km' ? <>{t('button')} <b>Attendance</b></> : <><b>Attendance</b> {t('button')}</>}), {t('sign in once, and then Telegram signs them in by itself. They get check-in receipts, approvals, payslips and a reminder if they forget to check out.')} {t('Uses the bot token in')} <b>{t('Telegram alerts for you')}</b> {t('above.')}</>}
        button="Attendance" onDone={reloadSettings}
      />
      <TelegramBotCard
        bot="admin" title={t('Admin bot · Admin Mini App')} username={f.telegramAdminBotUsername} setupAt={f.telegramAdminSetupAt} tokenSet={f.telegramAdminBotTokenSet} appUrl={f.manageUrl}
        about={<><b>{t('A second bot')}</b> {t("for admins, HR and managers: today's attendance, live list, one-tap approvals, staff history, and alerts (new requests, morning summary, late and absent, refused scans). Create it with @BotFather (e.g. MysoftkhAdminBot).")}</>}
        button="Admin" onDone={reloadSettings}
        tokenField={
          <Field label={t('Admin bot token')} hint={f.telegramAdminBotTokenSet ? t('Saved. Type a new one to replace it, then Save at the bottom.') : t('Not set. Paste it, then click Save plans & settings at the bottom.')}>
            <input className="input" type="password" autoComplete="off" value={secrets.telegramAdminBotToken} onChange={(e) => setSecrets({ ...secrets, telegramAdminBotToken: e.target.value })} placeholder={f.telegramAdminBotTokenSet ? '••••••••' : '123456:ABC…'} />
          </Field>
        }
      />

      <ErrorText error={error} />
      <div className="row"><button className="btn primary lg" disabled={busy} onClick={save}>{busy ? t('Saving…') : t('Save plans & settings')}</button></div>
    </>
  );
}

interface SetupResult { ok: boolean; botLink: string; steps: { step: string; ok: boolean; description?: string }[] }

/** One Telegram bot: its Mini App set-up (webhook, menu button, /start) and status. */
function TelegramBotCard({ bot, title, username, setupAt, tokenSet, appUrl, about, button, tokenField, onDone }: {
  bot: 'staff' | 'admin'; title: string; username: string | null; setupAt: string | null; tokenSet: boolean; appUrl: string; about: ReactNode; button: string;
  tokenField?: ReactNode; onDone: () => void;
}) {
  const [result, setResult] = useState<SetupResult | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {username && setupAt ? <Badge tone="good">@{username}</Badge> : <Badge tone="muted">{t('Not set up')}</Badge>}
      </div>
      <div className="card-body stack">
        <p className="muted" style={{ margin: 0 }}>{about}</p>
        {tokenField}
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy || !tokenSet} onClick={async () => {
            const r = await run(() => api<SetupResult>('/platform/telegram/setup', { method: 'POST', query: { bot } }));
            if (r) { setResult(r); onDone(); }
          }}>{setupAt ? t('Set up again') : t('Set up the Mini App')}</button>
          {username && <a className="btn" href={`https://t.me/${username}`} target="_blank" rel="noreferrer">{t('Open')} @{username}</a>}
        </div>
        {!tokenSet && <span className="faint small">{t('Save the bot token first.')}</span>}
        <ErrorText error={error} />
        {result && (
          <div className="stack tight">
            {result.steps.map((x) => (
              <div key={x.step} className="row small" style={{ gap: 8 }}>
                <Badge tone={x.ok ? 'good' : 'bad'}>{x.ok ? '✓' : '✗'}</Badge>{tServer(x.step)}{x.description && <span className="faint">: {x.description}</span>}
              </div>
            ))}
            <Alert tone={result.ok ? 'good' : 'warn'}>
              {result.ok ? <>{t('Done. Share')} <b>{result.botLink}</b>{t(': people press')} <b>Start</b>{t(', then')} <b>{button}</b>.</> : t('Some steps failed; check the bot token and try again.')}
            </Alert>
          </div>
        )}
        <p className="faint small" style={{ margin: 0 }}>{t('Opens')} <span className="mono">{appUrl}</span>. {t('After set-up the bot no longer answers getUpdates (Telegram sends updates to this server).')}</p>
      </div>
    </div>
  );
}
