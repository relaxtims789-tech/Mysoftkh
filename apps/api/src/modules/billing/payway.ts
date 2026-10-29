import * as crypto from 'crypto';

/**
 * ABA PayWay (https://developer.payway.com.kh): hosted checkout (KHQR, ABA Pay, cards) and the check-transaction API.
 * The browser posts a signed form to PayWay; afterwards we never trust the redirect or the pushback, we ask PayWay.
 */

export interface PaywayConfig {
  merchantId: string;
  apiKey: string;
  sandbox: boolean;
}

export const paywayBase = (sandbox: boolean) => (sandbox ? 'https://checkout-sandbox.payway.com.kh' : 'https://checkout.payway.com.kh');

/** UTC YYYYMMDDHHmmss. */
export function reqTime(d = new Date()): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function paywayHash(apiKey: string, parts: (string | number | undefined | null)[]): string {
  return crypto.createHmac('sha512', apiKey).update(parts.map((p) => (p === undefined || p === null ? '' : String(p))).join('')).digest('base64');
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Order of the fields in the purchase hash, as documented by PayWay. */
const PURCHASE_HASH_ORDER = [
  'req_time', 'merchant_id', 'tran_id', 'amount', 'items', 'shipping', 'firstname', 'lastname', 'email', 'phone', 'type', 'payment_option',
  'return_url', 'cancel_url', 'continue_success_url', 'return_deeplink', 'currency', 'custom_fields', 'return_params', 'payout', 'lifetime',
  'additional_params', 'google_pay_token', 'skip_success_page',
] as const;

export interface PurchaseInput {
  tranId: string;
  amount: number;
  currency: 'USD' | 'KHR';
  items: { name: string; quantity: number; price: number }[];
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  /** Server-to-server pushback after payment. */
  returnUrl: string;
  cancelUrl: string;
  continueSuccessUrl: string;
  returnParams?: string;
}

/** The form the browser posts to PayWay's hosted checkout. */
export function purchaseForm(cfg: PaywayConfig, p: PurchaseInput): { action: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {
    req_time: reqTime(),
    merchant_id: cfg.merchantId,
    tran_id: p.tranId,
    amount: p.currency === 'KHR' ? String(Math.round(p.amount)) : p.amount.toFixed(2),
    items: b64(JSON.stringify(p.items.map((i) => ({ name: i.name, quantity: i.quantity, price: p.currency === 'KHR' ? Math.round(i.price) : Number(i.price.toFixed(2)) })))),
    firstname: (p.firstname ?? '').slice(0, 100),
    lastname: (p.lastname ?? '').slice(0, 100),
    email: (p.email ?? '').slice(0, 50),
    phone: (p.phone ?? '').replace(/[^0-9+]/g, '').slice(0, 20),
    type: 'purchase',
    return_url: b64(p.returnUrl),
    cancel_url: p.cancelUrl,
    continue_success_url: p.continueSuccessUrl,
    currency: p.currency,
    return_params: p.returnParams ?? '',
  };
  fields.hash = paywayHash(cfg.apiKey, PURCHASE_HASH_ORDER.map((k) => fields[k]));
  return { action: `${paywayBase(cfg.sandbox)}/api/payment-gateway/v1/payments/purchase`, fields };
}

export interface CheckResult {
  /** PayWay answered (status code 00). */
  ok: boolean;
  approved: boolean;
  /** 0 approved, 2 pending, 3 declined, 4 refunded, 7 cancelled. */
  paymentStatusCode: number | null;
  paymentStatus: string | null;
  amount: number | null;
  currency: string | null;
  code: string | null;
  message: string;
}

/** Asks PayWay for the real state of a transaction (only works for transactions from the last 7 days). */
export async function checkTransaction(cfg: PaywayConfig, tranId: string, fetchImpl: typeof fetch = fetch): Promise<CheckResult> {
  const t = reqTime();
  const body = { req_time: t, merchant_id: cfg.merchantId, tran_id: tranId, hash: paywayHash(cfg.apiKey, [t, cfg.merchantId, tranId]) };
  let json: any;
  try {
    const res = await fetchImpl(`${paywayBase(cfg.sandbox)}/api/payment-gateway/v1/payments/check-transaction-2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    json = await res.json();
  } catch (e) {
    return { ok: false, approved: false, paymentStatusCode: null, paymentStatus: null, amount: null, currency: null, code: null, message: `PayWay did not answer (${(e as Error).message})` };
  }
  const data = json?.data ?? {};
  const status = data.status ?? json?.status ?? {};
  const code = status.code != null ? String(status.code) : null;
  const psc = data.payment_status_code != null ? Number(data.payment_status_code) : null;
  const ps = data.payment_status != null ? String(data.payment_status) : null;
  const approved = code === '00' && (psc === 0 || ps === 'APPROVED');
  return {
    ok: code === '00', approved, paymentStatusCode: psc, paymentStatus: ps,
    amount: data.payment_amount != null ? Number(data.payment_amount) : data.total_amount != null ? Number(data.total_amount) : null,
    currency: data.payment_currency ?? null, code, message: status.message ?? '',
  };
}
