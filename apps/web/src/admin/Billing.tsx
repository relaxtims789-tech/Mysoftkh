import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Billing as BillingState, reloadMe } from '../lib/api';
import { shortDate } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { REFUND_POLICY_VERSION, RefundPolicyAccept } from '../components/RefundPolicy';
import { Alert, Badge, Empty, ErrorText, Field, Loading, Modal, useAction, useConfirm, useLoad, useToast } from '../components/ui';
import { PageHead } from './shared';

interface Tier { id: string; minStaff: number; maxStaff: number; maxBranches: number | null; monthlyPrice: number; yearlyPrice: number }

/** "1 branch", "10 branches", "Unlimited branches" */
export const branchesLabel = (n: number | null | undefined) => (n == null ? t('Unlimited branches') : t(n === 1 ? '{n} branch' : '{n} branches', { n }));
interface Bank { bank: 'aba' | 'acleda'; name: string; accountName: string | null; accountNumber: string | null; qr: string | null }
export interface Invoice {
  id: string; number: string; companyId: string; companyName?: string; companyCode?: string; kind: 'renewal' | 'upgrade'; minStaff: number; maxStaff: number;
  cycle: 'monthly' | 'yearly'; months: number; amount: number; currency: string; status: 'unpaid' | 'submitted' | 'paid' | 'rejected' | 'cancelled';
  method: string | null; bank: string | null; hasReceipt: boolean; payerNote: string | null; paidAt: string | null; periodStart: string | null; periodEnd: string | null;
  reviewNote: string | null; reviewedBy: string | null; createdAt: string;
  policyVersion: string | null; policyAcceptedAt: string | null; policyAcceptedBy: string | null;
}
interface Overview {
  company: { name: string; code: string };
  status: BillingState; trialEndsAt: string | null; paidUntil: string | null; staffCount: number;
  branchCount: number; branchLimit: number | null; branchLimitCustom: boolean;
  tier: { id: string; minStaff: number; maxStaff: number; monthlyPrice: number } | null; suggestedTierId: string | null; canChangePlan: boolean;
  yearlyFreeMonths: number; graceDays: number; refundPolicyVersion: string; tiers: Tier[];
  payment: { payway: boolean; banks: Bank[] };
  contact: { phone: string | null; telegram: string | null; email: string | null };
  invoices: Invoice[];
}

export const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const STATE: Record<BillingState['state'], [string, string]> = {
  exempt: [t('Free plan'), 'good'], trial: [t('Free trial'), 'info'], active: [t('Active'), 'good'], grace: [t('Payment due'), 'warn'], expired: [t('Read-only'), 'bad'],
};
export const INVOICE_STATUS: Record<Invoice['status'], [string, string]> = {
  unpaid: [t('Waiting for payment'), 'warn'], submitted: [t('Receipt sent · checking'), 'info'], paid: [t('Paid'), 'good'], rejected: [t('Receipt rejected'), 'bad'], cancelled: [t('Cancelled'), 'muted'],
};
export const METHOD: Record<string, string> = { payway: 'ABA PayWay', bank_transfer: t('Bank transfer'), manual: t('Recorded by MySoft') };

/** "1–10 staff" */
const staffRange = (min: number, max: number) => t('{min}–{max} staff', { min, max });

/** Sends the browser to ABA PayWay's hosted checkout with the signed form from the API. */
function postToPayway(form: { action: string; fields: Record<string, string> }) {
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = form.action;
  for (const [k, v] of Object.entries(form.fields)) {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    f.appendChild(i);
  }
  document.body.appendChild(f);
  f.submit();
}

export function stateText(s: BillingState) {
  const d = (x: string | null) => (x ? shortDate(x) : '—');
  const left = s.daysLeft ?? 0;
  switch (s.state) {
    case 'trial': return t(left === 1 ? 'Free trial until {date} ({n} day left).' : 'Free trial until {date} ({n} days left).', { date: d(s.coveredUntil), n: left });
    case 'active': return t('Paid until {date}.', { date: d(s.coveredUntil) });
    case 'grace': return t('Ended on {date}. Everything keeps working until {grace}; please pay before then.', { date: d(s.coveredUntil), grace: d(s.graceUntil) });
    case 'expired': return t('Ended on {date}. The account is read-only: you can view and export, but staff cannot scan until you pay.', { date: d(s.coveredUntil) });
    default: return t('Free plan: no payment needed.');
  }
}

/** Company admin: plan, paying (ABA PayWay or bank transfer) and invoices. */
export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload, setData } = useLoad(() => api<Overview>('/billing'), []);
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [tierId, setTierId] = useState('');
  const [transfer, setTransfer] = useState<Invoice | null>(null);
  /** Ticked "I have read and agree" to the Cancellation & Refund Policy; every payment needs it. */
  const [agreed, setAgreed] = useState(false);
  const { busy, error: actionError, run } = useAction();
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    if (data && !tierId) setTierId(data.tier?.id ?? data.suggestedTierId ?? data.tiers[0]?.id ?? '');
  }, [data]);

  // Back from PayWay: ask PayWay whether the payment went through.
  useEffect(() => {
    const paid = params.get('paid');
    const cancelled = params.get('cancelled');
    if (cancelled) {
      toast(t('Payment cancelled'), 'info');
      setParams({}, { replace: true });
    }
    if (!paid) return;
    (async () => {
      for (let i = 0; i < 4; i++) {
        const r = await api<{ status: string }>(`/billing/invoices/${paid}/check`, { method: 'POST' }).catch(() => null);
        if (r?.status === 'paid') {
          toast(t('Payment received. Thank you!'));
          await reloadMe().catch(() => undefined);
          break;
        }
        await new Promise((ok) => setTimeout(ok, 2500));
        if (i === 3) toast(t('We have not received the payment yet. It can take a minute; refresh this page shortly.'), 'info');
      }
      setParams({}, { replace: true });
      reload();
    })();
  }, []);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorText error={error} />;
  const s = data.status;
  const tier = data.tiers.find((x) => x.id === tierId);
  const paidPeriod = s.state === 'active';
  const isUpgrade = paidPeriod && !!data.tier && !!tier && tier.maxStaff > data.tier.maxStaff;
  const amount = tier ? (cycle === 'yearly' && !isUpgrade ? tier.yearlyPrice : tier.monthlyPrice) : 0;
  const openInvoice = data.invoices.find((i) => i.status === 'unpaid' || i.status === 'submitted' || i.status === 'rejected');

  /** Payments need the policy accepted first: otherwise show the policy box. */
  function needPolicy() {
    if (agreed) return false;
    document.getElementById('refund-policy')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(t('Please read and accept the Cancellation & Refund Policy first.'), 'info');
    return true;
  }
  const policyBody = { body: { policyVersion: REFUND_POLICY_VERSION } };

  async function pay(method: 'payway' | 'transfer') {
    if (needPolicy()) return;
    const inv = await run(() => api<Invoice>('/billing/invoices', { body: { tierId, cycle: isUpgrade ? 'monthly' : cycle } }));
    if (!inv) return;
    if (method === 'payway') {
      const form = await run(() => api<{ action: string; fields: Record<string, string> }>(`/billing/invoices/${inv.id}/payway`, policyBody));
      if (form) postToPayway(form);
    } else {
      setTransfer(inv);
      reload();
    }
  }

  async function payInvoice(inv: Invoice, method: 'payway' | 'transfer') {
    if (needPolicy()) return;
    if (method === 'transfer') return setTransfer(inv);
    const form = await run(() => api<{ action: string; fields: Record<string, string> }>(`/billing/invoices/${inv.id}/payway`, policyBody));
    if (form) postToPayway(form);
  }

  return (
    <>
      <PageHead title={t('Billing & plan')} sub={t('{name} · company code {code}', { name: data.company.name, code: data.company.code })} />
      <div className="card card-pad stack">
        <div className="row wrap" style={{ gap: 12 }}>
          <Badge tone={STATE[s.state][1]}>{STATE[s.state][0]}</Badge>
          <span>{stateText(s)}</span>
        </div>
        {s.state !== 'exempt' && (
          <div className="kpis">
            <div className="card kpi"><span className="k-label">{t('Plan')}</span><span className="k-value" style={{ fontSize: 22 }}>{data.tier ? staffRange(data.tier.minStaff, data.tier.maxStaff) : t('None')}</span><span className="k-sub">{data.tier ? t('{amount} a month', { amount: usd(data.tier.monthlyPrice) }) : t('Choose one below')}</span></div>
            <div className="card kpi"><span className="k-label">{t('Active branches')}</span><span className="k-value">{data.branchCount}</span><span className="k-sub">{data.branchLimit == null ? t('No branch limit') : t(data.branchLimitCustom ? 'of {n} allowed (set by MySoft)' : 'of {n} allowed', { n: data.branchLimit })}</span></div>
            <div className="card kpi"><span className="k-label">{t('Active staff')}</span><span className="k-value">{data.staffCount}</span><span className="k-sub">{data.tier ? t('{n} more allowed', { n: Math.max(0, data.tier.maxStaff - data.staffCount) }) : ''}</span></div>
            <div className="card kpi"><span className="k-label">{s.state === 'trial' ? t('Trial ends') : t('Paid until')}</span><span className="k-value" style={{ fontSize: 22 }}>{s.coveredUntil ? shortDate(s.coveredUntil) : '—'}</span><span className="k-sub">{s.state === 'grace' || s.state === 'expired' ? t('Grace until {date}', { date: shortDate(s.graceUntil!) }) : ''}</span></div>
          </div>
        )}
        {s.state === 'expired' && <Alert tone="bad">{t('Your subscription has ended. Pay below to switch everything back on at once.')}</Alert>}
        {s.state === 'grace' && <Alert tone="warn">{t('Payment is due. After {date} the account becomes read-only and staff cannot scan.', { date: shortDate(s.graceUntil!) })}</Alert>}
      </div>
      <ErrorText error={actionError} />

      {s.state !== 'exempt' && (
        <div className="card">
          <div className="card-head">
            <h2>{isUpgrade ? t('Upgrade your plan') : paidPeriod ? t('Renew or upgrade') : t('Choose a plan and pay')}</h2>
            {!isUpgrade && (
              <div className="tabs" style={{ border: 0 }}>
                <button className={`tab${cycle === 'monthly' ? ' active' : ''}`} onClick={() => setCycle('monthly')}>{t('Monthly')}</button>
                <button className={`tab${cycle === 'yearly' ? ' active' : ''}`} onClick={() => setCycle('yearly')}>{t('Yearly')}{data.yearlyFreeMonths ? ` · ${t('{n} months free', { n: data.yearlyFreeMonths })}` : ''}</button>
              </div>
            )}
          </div>
          <div className="card-body stack">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {data.tiers.map((x) => {
                const tooSmall = x.maxStaff < data.staffCount || (!data.branchLimitCustom && x.maxBranches != null && x.maxBranches < data.branchCount);
                const on = x.id === tierId;
                const yearlyPrice = cycle === 'yearly' && !(paidPeriod && !!data.tier && x.maxStaff > data.tier.maxStaff);
                return (
                  <button key={x.id} type="button" disabled={tooSmall} onClick={() => setTierId(x.id)} className="card card-pad"
                    style={{ textAlign: 'left', cursor: tooSmall ? 'not-allowed' : 'pointer', opacity: tooSmall ? 0.45 : 1, borderColor: on ? 'var(--primary)' : undefined, boxShadow: on ? '0 0 0 2px var(--primary)' : 'none', font: 'inherit', color: 'inherit', background: 'var(--surface)' }}>
                    <div className="small muted" style={{ fontWeight: 700 }}>{staffRange(x.minStaff, x.maxStaff)}{data.tier?.id === x.id ? ` · ${t('current')}` : ''}</div>
                    <div className="faint small">{branchesLabel(x.maxBranches)}</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{usd(yearlyPrice ? x.yearlyPrice : x.monthlyPrice)}</div>
                    <div className="faint small">{yearlyPrice ? t('per year') : paidPeriod && data.tier && x.maxStaff > data.tier.maxStaff ? t('per month · upgrade') : t('per month')}</div>
                  </button>
                );
              })}
            </div>
            {tier && (
              <div className="row wrap" style={{ gap: 12 }}>
                <div className="grow">
                  {isUpgrade
                    ? <>{t('Upgrade to')} <b>{staffRange(tier.minStaff, tier.maxStaff)}</b> {t('now. You pay the difference for the rest of your paid period (until {date}).', { date: shortDate(data.paidUntil!) })}</>
                    : <><b>{usd(amount)}</b> {cycle === 'yearly' ? t('for 12 months of') : t('for 1 month of')} <b>{staffRange(tier.minStaff, tier.maxStaff)}</b>.{' '}
                      {s.coveredUntil && s.daysLeft !== null && s.daysLeft >= 0 ? t('Starts after {date}, so you lose no days.', { date: shortDate(s.coveredUntil) }) : t('Starts today.')}</>}
                </div>
                {data.canChangePlan && tier.id !== data.tier?.id && (
                  <button className="btn" disabled={busy} onClick={async () => {
                    const r = await run(() => api<Overview>('/billing/plan', { body: { tierId } }), t('Plan changed'));
                    if (r) setData(r);
                  }}>{t('Use this plan for the trial')}</button>
                )}
              </div>
            )}
            {tier && (data.payment.payway || data.payment.banks.length > 0) && (
              <>
                <RefundPolicyAccept checked={agreed} onChange={setAgreed} />
                <div className="row wrap" style={{ gap: 12, justifyContent: 'flex-end' }}>
                  {!agreed && <span className="faint small grow">{t('Tick “I have read and agree” above to pay.')}</span>}
                  {data.payment.payway && (
                    <button className="btn primary" disabled={busy || !agreed} onClick={() => pay('payway')}>
                      <Icon name="qr" size={16} /> {t('Pay online · ABA PayWay')}
                    </button>
                  )}
                  {data.payment.banks.length > 0 && (
                    <button className={`btn ${data.payment.payway ? '' : 'primary'}`} disabled={busy || !agreed} onClick={() => pay('transfer')}>
                      <Icon name="building" size={16} /> {t('Pay by bank transfer')}
                    </button>
                  )}
                </div>
              </>
            )}
            {!data.payment.payway && data.payment.banks.length === 0 && (
              <Alert tone="info">{data.contact.phone ? t('Online payment is being set up. Please contact us to pay: {phone}.', { phone: data.contact.phone }) : t('Online payment is being set up. Please contact us to pay.')}</Alert>
            )}
            <p className="faint small" style={{ margin: 0 }}>
              {t('ABA PayWay accepts KHQR (from ABA, ACLEDA or any Cambodian bank app), ABA Pay and cards; the plan is extended as soon as the payment is confirmed.')}{' '}
              {t('A bank transfer is checked by MySoft, usually within one working day.')}
            </p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>{t('Invoices')}</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Invoice')}</th><th>{t('Plan')}</th><th>{t('Period')}</th><th className="num">{t('Amount')}</th><th>{t('Paid by')}</th><th>{t('Status')}</th><th></th></tr></thead>
            <tbody>
              {data.invoices.length === 0 && <tr><td colSpan={7}><Empty icon="file">{t('No invoices yet.')}</Empty></td></tr>}
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <td><b className="mono">{i.number}</b><div className="faint small">{shortDate(i.createdAt.slice(0, 10))}</div></td>
                  <td>{staffRange(i.minStaff, i.maxStaff)}<div className="faint small">{i.kind === 'upgrade' ? t('Upgrade') : i.cycle === 'yearly' ? t('Yearly') : t('Monthly')}</div></td>
                  <td className="nowrap small">{i.periodStart ? `${shortDate(i.periodStart)} – ${shortDate(i.periodEnd)}` : '—'}</td>
                  <td className="num"><b>{usd(i.amount)}</b></td>
                  <td className="small">{i.method ? METHOD[i.method] : '—'}{i.bank ? ` · ${i.bank.toUpperCase()}` : ''}{i.policyVersion && <div className="faint">{t('Refund policy v{version} accepted', { version: i.policyVersion })}</div>}</td>
                  <td><Badge tone={INVOICE_STATUS[i.status][1]}>{INVOICE_STATUS[i.status][0]}</Badge>{i.status === 'rejected' && i.reviewNote && <div className="small" style={{ color: 'var(--bad)' }}>{i.reviewNote}</div>}</td>
                  <td>
                    {(i.status === 'unpaid' || i.status === 'rejected') && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {data.payment.payway && i.status === 'unpaid' && <button className="btn sm primary" disabled={busy} onClick={() => payInvoice(i, 'payway')}>{t('Pay online')}</button>}
                        {data.payment.banks.length > 0 && <button className="btn sm" disabled={busy} onClick={() => payInvoice(i, 'transfer')}>{i.status === 'rejected' ? t('Send receipt again') : t('Bank transfer')}</button>}
                        <button className="btn sm ghost" disabled={busy} onClick={async () => {
                          if ((await confirm({ title: t('Cancel {number}?', { number: i.number }), message: t('You can make a new invoice at any time.'), confirm: t('Cancel invoice'), danger: true })) === false) return;
                          await run(() => api(`/billing/invoices/${i.id}/cancel`, { method: 'POST' }), t('Invoice cancelled'));
                          reload();
                        }}>{t('Cancel')}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {openInvoice?.status === 'submitted' && <Alert tone="info">{t('We received your transfer receipt for {number} and are checking it.', { number: openInvoice.number })}</Alert>}
      {(data.contact.phone || data.contact.telegram || data.contact.email) && (
        <p className="faint small">{t('Questions about billing?')} {[data.contact.phone, data.contact.telegram && `Telegram ${data.contact.telegram}`, data.contact.email].filter(Boolean).join(' · ')}</p>
      )}
      {transfer && <TransferModal invoice={transfer} banks={data.payment.banks} onClose={() => setTransfer(null)} onDone={() => { setTransfer(null); reload(); }} />}
    </>
  );
}

function TransferModal({ invoice, banks, onClose, onDone }: { invoice: Invoice; banks: Bank[]; onClose: () => void; onDone: () => void }) {
  const [bank, setBank] = useState<Bank['bank']>(banks[0]?.bank ?? 'aba');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const b = banks.find((x) => x.bank === bank) ?? banks[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append('bank', bank);
    form.append('policyVersion', REFUND_POLICY_VERSION);
    if (note.trim()) form.append('note', note.trim());
    form.append('file', file);
    const ok = await run(() => api(`/billing/invoices/${invoice.id}/transfer`, { form }), t('Receipt sent. We will confirm it soon.'));
    if (ok) onDone();
  }

  return (
    <Modal title={t('Pay {number} by bank transfer', { number: invoice.number })} onClose={onClose} wide footer={
      <><button className="btn" onClick={onClose}>{t('Later')}</button><button className="btn primary" form="tr-form" disabled={busy || !file}>{busy ? t('Sending…') : t('Send receipt')}</button></>
    }>
      <form id="tr-form" className="stack" onSubmit={submit}>
        <div className="row wrap" style={{ gap: 8 }}>
          {banks.map((x) => (
            <button key={x.bank} type="button" className={`btn ${x.bank === bank ? 'primary' : ''}`} onClick={() => setBank(x.bank)}>{x.name}</button>
          ))}
        </div>
        <div className="grid2" style={{ alignItems: 'start' }}>
          <dl className="kv" style={{ margin: 0 }}>
            <dt>{t('Amount')}</dt><dd style={{ fontSize: 20, fontWeight: 800 }}>{usd(invoice.amount)}</dd>
            <dt>{t('Bank')}</dt><dd>{b?.name}</dd>
            <dt>{t('Account name')}</dt><dd>{b?.accountName ?? '—'}</dd>
            <dt>{t('Account number')}</dt><dd className="mono" style={{ fontSize: 17 }}>{b?.accountNumber ?? '—'}</dd>
            <dt>{t('Remark / purpose')}</dt><dd className="mono">{invoice.number}</dd>
          </dl>
          {b?.qr ? <img src={b.qr} alt={`${b.name} KHQR`} style={{ width: '100%', maxWidth: 240, borderRadius: 12, border: '1px solid var(--border)', justifySelf: 'center' }} /> : <div />}
        </div>
        <p className="faint small" style={{ margin: 0 }}><Icon name="check" size={14} /> {t('You accepted the')} <a href="/refund-policy" target="_blank" rel="noreferrer">{t('Cancellation & Refund Policy')}</a> {t('(version {version}). Payments are final except for our errors.', { version: REFUND_POLICY_VERSION })}</p>
        <Alert tone="info">{t('Transfer exactly {amount} and write', { amount: usd(invoice.amount) })} <b className="mono">{invoice.number}</b> {t('in the remark. Then attach a screenshot of the receipt from your bank app.')}</Alert>
        <Field label={t('Receipt (photo or PDF, max 5 MB)')}>
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        </Field>
        <Field label={t('Note (optional)')}><input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. Paid from ACLEDA app, name Sok Dara')} /></Field>
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}
