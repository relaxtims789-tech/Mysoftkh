import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config';
import { Db, Queryable } from '../../database/db.service';
import { AuthUser } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound, rethrowUnique } from '../../common/errors';
import { hashPassword, openSecret, randomToken, sealSecret } from '../../common/crypto';
import { normalizePhone } from '../../common/phone';
import {
  addDaysIso, addMonthsIso, billingStatus, BillingStatus, branchLimit, Cycle, priceFor, renewalPeriod, Tier, tierFor, upgradePrice,
} from '../../domain/billing';
import { localParts } from '../../domain/time';
import { AuditService, diff } from '../audit/audit.service';
import { UploadsService } from '../uploads/uploads.service';
import { TelegramService } from '../core/telegram.service';
import { checkTransaction, CheckResult, PaywayConfig, purchaseForm } from './payway';

/** SET clause recording the policy acceptance on an invoice; `n` is the parameter number of the version, then user and ip follow. */
const policySet = (n: number) => `policy_version = $${n}, policy_accepted_at = now(), policy_accepted_by = $${n + 1}, policy_accepted_ip = $${n + 2}`;
const PLATFORM_TZ = 'Asia/Phnom_Penh';
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
/** MySoft's Telegram QR, shipped with the web app; used until the super admin uploads another. */
const DEFAULT_TELEGRAM_QR = '/brand/telegram-qr.png';
/** Current Cancellation & Refund Policy version; keep in step with apps/web/src/lib/refund-policy.ts. */
export const REFUND_POLICY_VERSION = '1.0';
export const COMPANY_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

export interface PlatformSettingsInput {
  trialMonths?: number;
  graceDays?: number;
  yearlyFreeMonths?: number;
  abaAccountName?: string | null;
  abaAccountNumber?: string | null;
  acledaAccountName?: string | null;
  acledaAccountNumber?: string | null;
  paywayEnabled?: boolean;
  paywaySandbox?: boolean;
  paywayMerchantId?: string | null;
  /** Empty string clears it; undefined keeps it. */
  paywayApiKey?: string;
  salesPhone?: string | null;
  salesTelegram?: string | null;
  salesEmail?: string | null;
  telegramBotToken?: string;
  /** Admins' bot (Mini App /manage). Empty string clears it; undefined keeps it. */
  telegramAdminBotToken?: string;
  telegramChatId?: string | null;
}

export interface SignupInput {
  companyName: string;
  companyCode?: string;
  fullName: string;
  email: string;
  phone: string;
  password: string;
  tierId: string;
}

const mapTier = (r: any): Tier & { active: boolean; maxBranches: number | null } => ({
  id: r.id, minStaff: r.min_staff, maxStaff: r.max_staff, monthlyPrice: Number(r.monthly_price), maxBranches: r.max_branches ?? null, active: r.active,
});

function sniffReceipt(buf: Buffer): 'png' | 'jpg' | 'webp' | 'pdf' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 4 && buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  return null;
}

export const RECEIPT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };

/**
 * Selling the system: public plans and sign-up with a free trial, plans by number of staff, invoices paid with
 * ABA PayWay (checked with PayWay before the plan is extended) or by bank transfer (receipt approved by the super admin).
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing');
  /** Tests replace this to fake PayWay. */
  paywayFetch: typeof fetch = fetch;

  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly uploads: UploadsService, private readonly telegram: TelegramService) {}

  today(): string {
    return localParts(new Date(), PLATFORM_TZ).date;
  }

  // ---------- platform settings ----------

  private async settingsRow(tx: Queryable = this.db) {
    return tx.one('SELECT * FROM platform_settings WHERE id = 1');
  }

  private paywayConfig(r: any): PaywayConfig | null {
    const apiKey = openSecret(config.jwtSecret, r.payway_api_key);
    if (!r.payway_enabled || !r.payway_merchant_id || !apiKey) return null;
    return { merchantId: r.payway_merchant_id, apiKey, sandbox: r.payway_sandbox };
  }

  private banks(r: any) {
    const list: { bank: 'aba' | 'acleda'; name: string; accountName: string | null; accountNumber: string | null; qr: string | null }[] = [];
    if (r.aba_account_number || r.aba_qr) list.push({ bank: 'aba', name: 'ABA Bank', accountName: r.aba_account_name, accountNumber: r.aba_account_number, qr: r.aba_qr });
    if (r.acleda_account_number || r.acleda_qr) list.push({ bank: 'acleda', name: 'ACLEDA Bank', accountName: r.acleda_account_name, accountNumber: r.acleda_account_number, qr: r.acleda_qr });
    return list;
  }

  async tiers(includeInactive = false): Promise<(Tier & { active: boolean })[]> {
    const rows = await this.db.query(`SELECT * FROM price_tiers ${includeInactive ? '' : 'WHERE active'} ORDER BY max_staff`);
    return rows.map(mapTier);
  }

  /** What the public website shows. */
  async publicInfo() {
    const r = await this.settingsRow();
    const tiers = await this.tiers();
    return {
      /** The address of the app (sign-up, dashboard, phone app). The website may be shown on other addresses. */
      appUrl: config.publicUrl,
      currency: 'USD',
      trialMonths: r.trial_months,
      yearlyFreeMonths: r.yearly_free_months,
      tiers: tiers.map((t) => ({ id: t.id, minStaff: t.minStaff, maxStaff: t.maxStaff, maxBranches: t.maxBranches, monthlyPrice: t.monthlyPrice, yearlyPrice: priceFor(t, 'yearly', r.yearly_free_months).amount })),
      payment: { payway: !!this.paywayConfig(r), banks: this.banks(r).map((b) => ({ bank: b.bank, name: b.name })) },
      contact: { phone: r.sales_phone, telegram: r.sales_telegram, email: r.sales_email, telegramQr: r.sales_telegram_qr ?? DEFAULT_TELEGRAM_QR },
    };
  }

  /** Super admin view: secrets are never sent back, only whether they are set. */
  async adminSettings() {
    const r = await this.settingsRow();
    return {
      trialMonths: r.trial_months, graceDays: r.grace_days, yearlyFreeMonths: r.yearly_free_months,
      abaAccountName: r.aba_account_name, abaAccountNumber: r.aba_account_number, abaQr: r.aba_qr,
      acledaAccountName: r.acleda_account_name, acledaAccountNumber: r.acleda_account_number, acledaQr: r.acleda_qr,
      paywayEnabled: r.payway_enabled, paywaySandbox: r.payway_sandbox, paywayMerchantId: r.payway_merchant_id,
      paywayApiKeySet: !!openSecret(config.jwtSecret, r.payway_api_key), paywayReady: !!this.paywayConfig(r),
      paywayCallbackUrl: `${config.publicUrl}/api/public/payway/callback`,
      salesPhone: r.sales_phone, salesTelegram: r.sales_telegram, salesEmail: r.sales_email,
      salesTelegramQr: r.sales_telegram_qr, defaultTelegramQr: DEFAULT_TELEGRAM_QR,
      telegramBotTokenSet: !!openSecret(config.jwtSecret, r.telegram_bot_token), telegramChatId: r.telegram_chat_id,
      telegramBotUsername: r.telegram_bot_username, telegramSetupAt: r.telegram_setup_at,
      telegramAdminBotTokenSet: !!openSecret(config.jwtSecret, r.telegram_admin_bot_token), telegramAdminBotUsername: r.telegram_admin_bot_username,
      telegramAdminSetupAt: r.telegram_admin_setup_at, manageUrl: `${config.publicUrl.replace(/\/$/, '')}/manage`, appUrl: `${config.publicUrl.replace(/\/$/, '')}/app`,
    };
  }

  async updateSettings(input: PlatformSettingsInput, actor: AuthUser, ip: string) {
    const before = await this.adminSettings();
    const r = await this.settingsRow();
    const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : v);
    const trimOrNull = (v: string | null | undefined, cur: string | null) => (v === undefined ? cur : v?.trim() || null);
    const seal = (v: string | undefined, cur: string | null) => (v === undefined ? cur : v.trim() ? sealSecret(config.jwtSecret, v.trim()) : null);
    await this.db.query(
      `UPDATE platform_settings SET trial_months = $1, grace_days = $2, yearly_free_months = $3, aba_account_name = $4, aba_account_number = $5,
              acleda_account_name = $6, acleda_account_number = $7, payway_enabled = $8, payway_sandbox = $9, payway_merchant_id = $10, payway_api_key = $11,
              sales_phone = $12, sales_telegram = $13, sales_email = $14, telegram_bot_token = $15, telegram_chat_id = $16, updated_at = now()
        WHERE id = 1`,
      [
        pick(input.trialMonths, r.trial_months), pick(input.graceDays, r.grace_days), pick(input.yearlyFreeMonths, r.yearly_free_months),
        trimOrNull(input.abaAccountName, r.aba_account_name), trimOrNull(input.abaAccountNumber, r.aba_account_number),
        trimOrNull(input.acledaAccountName, r.acleda_account_name), trimOrNull(input.acledaAccountNumber, r.acleda_account_number),
        pick(input.paywayEnabled, r.payway_enabled), pick(input.paywaySandbox, r.payway_sandbox), trimOrNull(input.paywayMerchantId, r.payway_merchant_id),
        seal(input.paywayApiKey, r.payway_api_key), trimOrNull(input.salesPhone, r.sales_phone), trimOrNull(input.salesTelegram, r.sales_telegram),
        trimOrNull(input.salesEmail, r.sales_email), seal(input.telegramBotToken, r.telegram_bot_token), trimOrNull(input.telegramChatId, r.telegram_chat_id),
      ],
    );
    if (input.telegramAdminBotToken !== undefined) {
      await this.db.query('UPDATE platform_settings SET telegram_admin_bot_token = $1 WHERE id = 1', [seal(input.telegramAdminBotToken, r.telegram_admin_bot_token)]);
    }
    this.telegram.forgetToken();
    const after = await this.adminSettings();
    const d = diff(before as any, after as any);
    await this.audit.log({ companyId: null, userId: actor.id, action: 'update', module: 'platform_settings', recordId: '1', oldValue: d.old, newValue: d.new, ip });
    return after;
  }

  /** KHQR image of a bank account, or the Telegram QR shown on the website. No file = remove it. */
  async setBankQr(bank: 'aba' | 'acleda' | 'telegram', file: Express.Multer.File | undefined, actor: AuthUser, ip: string) {
    const r = await this.settingsRow();
    const col = bank === 'aba' ? 'aba_qr' : bank === 'acleda' ? 'acleda_qr' : 'sales_telegram_qr';
    const url = file ? this.uploads.saveImage(file, 'logo') : null;
    await this.db.query(`UPDATE platform_settings SET ${col} = $1, updated_at = now() WHERE id = 1`, [url]);
    this.uploads.remove(r[col]);
    await this.audit.log({ companyId: null, userId: actor.id, action: url ? 'update' : 'delete', module: 'platform_settings', recordId: col, newValue: { [col]: url }, ip });
    return this.adminSettings();
  }

  /** Checks the PayWay credentials: an unknown transaction must come back as "not found", not "invalid hash / merchant". */
  async testPayway() {
    const r = await this.settingsRow();
    const apiKey = openSecret(config.jwtSecret, r.payway_api_key);
    if (!r.payway_merchant_id || !apiKey) throw badRequest('Enter the PayWay merchant ID and API key first.', 'PAYWAY_NOT_SET');
    const res = await checkTransaction({ merchantId: r.payway_merchant_id, apiKey, sandbox: r.payway_sandbox }, `TEST${Date.now()}`.slice(0, 20), this.paywayFetch);
    const good = res.code === '6' || res.code === '00';
    return { ok: good, code: res.code, message: good ? 'PayWay accepted the merchant ID and API key.' : `PayWay said: ${res.message || 'no answer'} (code ${res.code ?? '-'})` };
  }

  async updateTiers(list: { id?: string; minStaff: number; maxStaff: number; monthlyPrice: number; maxBranches?: number | null; active?: boolean }[], actor: AuthUser, ip: string) {
    const sorted = [...list].sort((a, b) => a.maxStaff - b.maxStaff);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].minStaff > sorted[i].maxStaff) throw badRequest(`"${sorted[i].minStaff}-${sorted[i].maxStaff}": from must be ≤ to.`, 'BAD_TIERS');
      if (i > 0 && sorted[i].minStaff <= sorted[i - 1].maxStaff) throw badRequest(`Staff ranges overlap at ${sorted[i].minStaff}.`, 'BAD_TIERS');
    }
    const before = await this.tiers(true);
    await this.db.tx(async (tx) => {
      const keep: string[] = [];
      for (const t of sorted) {
        if (t.id) {
          keep.push(t.id);
          // maxBranches left out = keep the current branch limit.
          await tx.query(
            `UPDATE price_tiers SET min_staff = $2, max_staff = $3, monthly_price = $4, active = $5,
                    max_branches = CASE WHEN $7 THEN $6::int ELSE max_branches END, updated_at = now() WHERE id = $1`,
            [t.id, t.minStaff, t.maxStaff, t.monthlyPrice, t.active ?? true, t.maxBranches ?? null, t.maxBranches !== undefined],
          );
        } else {
          keep.push((await tx.one('INSERT INTO price_tiers (min_staff, max_staff, monthly_price, active, max_branches) VALUES ($1, $2, $3, $4, $5) RETURNING id', [t.minStaff, t.maxStaff, t.monthlyPrice, t.active ?? true, t.maxBranches ?? null])).id);
        }
      }
      // Tiers left out stay for the companies and invoices that use them, hidden from new customers.
      await tx.query('UPDATE price_tiers SET active = false, updated_at = now() WHERE NOT (id = ANY($1::uuid[]))', [keep]);
    });
    await this.audit.log({ companyId: null, userId: actor.id, action: 'update', module: 'price_tiers', oldValue: { tiers: before }, newValue: { tiers: sorted }, ip });
    return this.tiers(true);
  }

  // ---------- company billing ----------

  private async companyRow(companyId: string, tx: Queryable = this.db) {
    const r = await tx.maybeOne(
      `SELECT c.*, t.min_staff, t.max_staff, t.monthly_price, t.id AS tier_id_,
              (SELECT count(*) FROM employees e WHERE e.company_id = c.id AND e.status = 'active')::int AS staff_count,
              (SELECT count(*) FROM branches b WHERE b.company_id = c.id AND b.status = 'active')::int AS branch_count, t.max_branches
         FROM companies c LEFT JOIN price_tiers t ON t.id = c.tier_id WHERE c.id = $1`,
      [companyId],
    );
    if (!r) throw notFound('Company');
    return r;
  }

  private statusOf(c: any, graceDays: number): BillingStatus {
    return billingStatus({ exempt: c.billing_exempt, trialEndsAt: c.trial_ends_at, paidUntil: c.paid_until }, this.today(), graceDays);
  }

  private mapInvoice(r: any) {
    return {
      id: r.id, number: r.number, companyId: r.company_id, companyName: r.company_name ?? undefined, companyCode: r.company_code ?? undefined,
      kind: r.kind, minStaff: r.min_staff, maxStaff: r.max_staff, cycle: r.cycle, months: r.months, amount: Number(r.amount), currency: r.currency,
      status: r.status, method: r.method, bank: r.bank, hasReceipt: !!r.receipt_file, payerNote: r.payer_note, paidAt: r.paid_at,
      periodStart: r.period_start, periodEnd: r.period_end, reviewNote: r.review_note, reviewedBy: r.reviewed_by_name ?? null, createdAt: r.created_at,
      policyVersion: r.policy_version ?? null, policyAcceptedAt: r.policy_accepted_at ?? null, policyAcceptedBy: r.policy_accepted_by_name ?? null,
    };
  }

  private async invoicesOf(companyId: string) {
    const rows = await this.db.query(
      `SELECT i.*, u.name AS reviewed_by_name, pa.name AS policy_accepted_by_name FROM invoices i LEFT JOIN users u ON u.id = i.reviewed_by
       LEFT JOIN users pa ON pa.id = i.policy_accepted_by WHERE i.company_id = $1 ORDER BY i.created_at DESC LIMIT 50`,
      [companyId],
    );
    return rows.map((r) => this.mapInvoice(r));
  }

  /** The company admin's Billing page. */
  async overview(companyId: string) {
    const [c, s, tiers] = await Promise.all([this.companyRow(companyId), this.settingsRow(), this.tiers()]);
    const status = this.statusOf(c, s.grace_days);
    const current = c.tier_id_ ? { id: c.tier_id_, minStaff: c.min_staff, maxStaff: c.max_staff, monthlyPrice: Number(c.monthly_price) } : null;
    return {
      company: { id: c.id, name: c.name, code: c.code, contactName: c.contact_name, contactPhone: c.contact_phone, contactEmail: c.contact_email },
      status,
      trialEndsAt: c.trial_ends_at,
      paidUntil: c.paid_until,
      staffCount: c.staff_count,
      branchCount: c.branch_count,
      branchLimit: this.branchLimitOf(c),
      branchLimitCustom: c.branch_limit_custom,
      tier: current ? { ...current, maxBranches: c.max_branches ?? null } : null,
      suggestedTierId: tierFor(tiers, Math.max(1, c.staff_count))?.id ?? null,
      /** During a paid period the plan only changes through an upgrade invoice. */
      canChangePlan: status.state !== 'active' && status.state !== 'exempt',
      yearlyFreeMonths: s.yearly_free_months,
      graceDays: s.grace_days,
      refundPolicyVersion: REFUND_POLICY_VERSION,
      tiers: tiers.map((t) => ({ ...t, yearlyPrice: priceFor(t, 'yearly', s.yearly_free_months).amount })),
      payment: { payway: !!this.paywayConfig(s), banks: this.banks(s) },
      contact: { phone: s.sales_phone, telegram: s.sales_telegram, email: s.sales_email },
      invoices: await this.invoicesOf(companyId),
    };
  }

  /** Trial / lapsed companies pick their plan freely; the limit is the plan's staff range. */
  async choosePlan(user: AuthUser, tierId: string, ip: string) {
    const companyId = user.companyId!;
    const [c, s] = await Promise.all([this.companyRow(companyId), this.settingsRow()]);
    const status = this.statusOf(c, s.grace_days);
    if (status.state === 'active') throw badRequest('Your plan is paid. To get more staff, upgrade it with an upgrade invoice.', 'PLAN_PAID');
    const tier = await this.tierById(tierId);
    if (c.staff_count > tier.maxStaff) throw badRequest(`You have ${c.staff_count} active staff; choose a plan for at least ${c.staff_count}.`, 'PLAN_TOO_SMALL');
    this.assertBranchesFit(c, tier);
    await this.db.query('UPDATE companies SET tier_id = $2, updated_at = now() WHERE id = $1', [companyId, tierId]);
    await this.audit.log({ companyId, userId: user.id, action: 'change_plan', module: 'billing', recordId: companyId, oldValue: { tierId: c.tier_id }, newValue: { tierId }, ip });
    return this.overview(companyId);
  }

  /** Branches allowed for a company row (custom number set by the super admin, else the plan's; null = unlimited). */
  private branchLimitOf(c: any): number | null {
    return branchLimit({ custom: c.branch_limit_custom, customLimit: c.branch_limit, exempt: c.billing_exempt, planMax: c.max_branches, hasPlan: !!c.tier_id });
  }

  /** A smaller plan must still cover the company's active branches (unless the super admin set its own number). */
  private assertBranchesFit(c: any, tier: { maxBranches?: number | null }) {
    if (c.branch_limit_custom || tier.maxBranches == null || c.branch_count <= tier.maxBranches) return;
    throw badRequest(`You have ${c.branch_count} active branches; this plan allows ${tier.maxBranches}. Choose a bigger plan or turn off branches first.`, 'PLAN_TOO_FEW_BRANCHES');
  }

  private async tierById(id: string, tx: Queryable = this.db) {
    const t = await tx.maybeOne('SELECT * FROM price_tiers WHERE id = $1 AND active', [id]);
    if (!t) throw badRequest('That plan is not available.', 'BAD_PLAN');
    return mapTier(t);
  }

  private async nextNumber(tx: Queryable) {
    const n = (await tx.one(`SELECT nextval('invoice_number_seq') AS n`)).n;
    return `INV-${this.today().slice(0, 4)}-${String(n).padStart(5, '0')}`;
  }

  /**
   * Renewal for a plan and cycle, or (during a paid period, for a bigger plan) an upgrade for the rest of the period.
   * Older unpaid invoices of the company are cancelled.
   */
  async createInvoice(companyId: string, tierId: string, cycle: Cycle, actor: AuthUser | null, ip: string, tx0?: Queryable) {
    const run = async (tx: Queryable) => {
      const [c, s] = await Promise.all([this.companyRow(companyId, tx), this.settingsRow(tx)]);
      const tier = await this.tierById(tierId, tx);
      const status = this.statusOf(c, s.grace_days);
      if (status.state === 'exempt') throw badRequest('This company is on a free plan and does not need to pay.', 'EXEMPT');
      if (c.staff_count > tier.maxStaff) throw badRequest(`You have ${c.staff_count} active staff; choose a plan for at least ${c.staff_count}.`, 'PLAN_TOO_SMALL');
      this.assertBranchesFit(c, tier);
      const today = this.today();
      let kind: 'renewal' | 'upgrade' = 'renewal';
      let months: number;
      let amount: number;
      let period: { start: string; end: string };
      if (status.state === 'active' && c.paid_until && c.max_staff != null && tier.maxStaff > c.max_staff) {
        kind = 'upgrade';
        const up = upgradePrice({ monthlyPrice: Number(c.monthly_price) }, tier, today, c.paid_until);
        months = up.months;
        amount = up.amount;
        period = { start: today, end: c.paid_until };
      } else {
        const p = priceFor(tier, cycle, s.yearly_free_months);
        months = p.months;
        amount = p.amount;
        period = renewalPeriod({ exempt: false, trialEndsAt: c.trial_ends_at, paidUntil: c.paid_until }, today, months);
      }
      await tx.query(`UPDATE invoices SET status = 'cancelled', updated_at = now() WHERE company_id = $1 AND status = 'unpaid'`, [companyId]);
      const r = await tx.one(
        `INSERT INTO invoices (company_id, number, kind, tier_id, min_staff, max_staff, cycle, months, amount, period_start, period_end, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [companyId, await this.nextNumber(tx), kind, tier.id, tier.minStaff, tier.maxStaff, kind === 'upgrade' ? 'monthly' : cycle, months, amount, period.start, period.end, actor?.id ?? null],
      );
      await this.audit.log({ companyId, userId: actor?.id ?? null, action: 'create', module: 'invoices', recordId: r.id, newValue: { number: r.number, kind, amount, months }, ip }, tx);
      return this.mapInvoice(r);
    };
    return tx0 ? run(tx0) : this.db.tx(run);
  }

  private async invoiceFor(user: AuthUser, id: string, tx: Queryable = this.db, lock = false) {
    const r = await tx.maybeOne(`SELECT * FROM invoices WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
    if (!r) throw notFound('Invoice');
    if (user.role !== 'super_admin' && r.company_id !== user.companyId) throw notFound('Invoice');
    return r;
  }

  async cancelInvoice(user: AuthUser, id: string, ip: string) {
    const r = await this.invoiceFor(user, id);
    if (r.status !== 'unpaid' && r.status !== 'submitted') throw badRequest('Only unpaid invoices can be cancelled.', 'NOT_UNPAID');
    await this.db.query(`UPDATE invoices SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
    await this.audit.log({ companyId: r.company_id, userId: user.id, action: 'cancel', module: 'invoices', recordId: id, ip });
    return { ok: true };
  }

  /** Every payment needs the customer's acceptance of the current Cancellation & Refund Policy. */
  private assertPolicy(version: string | undefined) {
    if (version !== REFUND_POLICY_VERSION) {
      throw badRequest('Please read and accept the Cancellation & Refund Policy before paying.', 'POLICY_NOT_ACCEPTED', { version: REFUND_POLICY_VERSION });
    }
  }

  /** The signed form for PayWay's hosted checkout. A new transaction id per attempt. */
  async paywayCheckout(user: AuthUser, id: string, policyVersion: string | undefined, ip: string) {
    this.assertPolicy(policyVersion);
    const s = await this.settingsRow();
    const cfg = this.paywayConfig(s);
    if (!cfg) throw badRequest('Online payment is not available yet. Please pay by bank transfer.', 'PAYWAY_OFF');
    const inv = await this.invoiceFor(user, id);
    if (inv.status !== 'unpaid') throw badRequest('This invoice is not waiting for payment.', 'NOT_UNPAID');
    const c = await this.companyRow(inv.company_id);
    const tranId = `Q${Date.now().toString(36)}${randomToken(4).replace(/[^A-Za-z0-9]/g, '').slice(0, 5)}`.toUpperCase().slice(0, 20);
    await this.db.query(
      `UPDATE invoices SET payway_tran_id = $2, method = 'payway', ${policySet(3)}, updated_at = now() WHERE id = $1`,
      [id, tranId, REFUND_POLICY_VERSION, user.id, ip],
    );
    await this.audit.log({ companyId: inv.company_id, userId: user.id, action: 'accept_refund_policy', module: 'invoices', recordId: id, newValue: { version: REFUND_POLICY_VERSION, method: 'payway' }, ip });
    const [first, ...rest] = String(c.contact_name ?? user.name ?? '').trim().split(/\s+/);
    const label = `MySoft QR and Phones Attendance ${inv.min_staff}-${inv.max_staff} staff, ${inv.kind === 'upgrade' ? 'upgrade' : `${inv.months} month${inv.months > 1 ? 's' : ''}`}`;
    return purchaseForm(cfg, {
      tranId, amount: Number(inv.amount), currency: 'USD', items: [{ name: label, quantity: 1, price: Number(inv.amount) }],
      firstname: first, lastname: rest.join(' '), email: c.contact_email ?? '', phone: c.contact_phone ?? '',
      returnUrl: `${config.publicUrl}/api/public/payway/callback`,
      cancelUrl: `${config.publicUrl}/admin/billing?cancelled=${inv.id}`,
      continueSuccessUrl: `${config.publicUrl}/admin/billing?paid=${inv.id}`,
      returnParams: inv.number,
    });
  }

  /** Asks PayWay about the invoice's transaction and extends the plan when it is approved for the full amount. */
  async verifyPayway(invoiceId: string): Promise<{ status: string; result: CheckResult | null }> {
    const inv = await this.db.maybeOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'paid') return { status: 'paid', result: null };
    if (!inv.payway_tran_id) return { status: inv.status, result: null };
    const cfg = this.paywayConfig(await this.settingsRow());
    if (!cfg) return { status: inv.status, result: null };
    const res = await checkTransaction(cfg, inv.payway_tran_id, this.paywayFetch);
    if (res.approved && (res.currency ?? 'USD') === inv.currency && (res.amount ?? 0) + 0.001 >= Number(inv.amount)) {
      await this.markPaid(inv.id, 'payway', null, `PayWay ${inv.payway_tran_id}`, 'system');
      return { status: 'paid', result: res };
    }
    return { status: inv.status, result: res };
  }

  async verifyForUser(user: AuthUser, id: string) {
    await this.invoiceFor(user, id);
    return this.verifyPayway(id);
  }

  /** PayWay pushback (server to server). Never trusted on its own: the transaction is checked with PayWay. */
  async paywayCallback(tranId: string | undefined) {
    if (!tranId || !/^[A-Za-z0-9_-]{1,40}$/.test(tranId)) return { ok: false };
    const inv = await this.db.maybeOne('SELECT id FROM invoices WHERE payway_tran_id = $1', [tranId]);
    if (!inv) return { ok: false };
    const r = await this.verifyPayway(inv.id);
    return { ok: r.status === 'paid' };
  }

  /** Bank transfer: the customer uploads the receipt; the super admin checks it and approves. */
  async submitTransfer(user: AuthUser, id: string, bank: 'aba' | 'acleda', file: Express.Multer.File | undefined, note: string | undefined, ip: string, policyVersion?: string) {
    this.assertPolicy(policyVersion);
    const inv = await this.invoiceFor(user, id);
    if (inv.status !== 'unpaid' && inv.status !== 'rejected') throw badRequest('This invoice is not waiting for payment.', 'NOT_UNPAID');
    if (!file?.buffer?.length) throw badRequest('Attach a photo or PDF of the transfer receipt.', 'NO_FILE');
    if (file.buffer.length > MAX_RECEIPT_BYTES) throw badRequest('The receipt is larger than 5 MB.', 'FILE_TOO_LARGE');
    const ext = sniffReceipt(file.buffer);
    if (!ext) throw badRequest('The receipt must be a PNG, JPEG, WebP image or a PDF.', 'BAD_FILE_TYPE');
    const dir = path.join(config.storageDir, 'receipts');
    fs.mkdirSync(dir, { recursive: true });
    const name = `receipt-${randomToken(18)}.${ext}`;
    fs.writeFileSync(path.join(dir, name), file.buffer);
    if (inv.receipt_file) fs.rm(path.join(dir, path.basename(inv.receipt_file)), { force: true }, () => undefined);
    await this.db.query(
      `UPDATE invoices SET status = 'submitted', method = 'bank_transfer', bank = $2, receipt_file = $3, payer_note = $4, ${policySet(5)}, updated_at = now() WHERE id = $1`,
      [id, bank, name, note?.trim() || null, REFUND_POLICY_VERSION, user.id, ip],
    );
    await this.audit.log({ companyId: inv.company_id, userId: user.id, action: 'submit_transfer', module: 'invoices', recordId: id, newValue: { bank, refundPolicy: REFUND_POLICY_VERSION }, ip });
    const c = await this.companyRow(inv.company_id);
    this.notify(`💳 Bank transfer to check\n${c.name} (${c.code})\n${inv.number}: ${Number(inv.amount).toFixed(2)} USD via ${bank.toUpperCase()}\nApprove it in Payments.`);
    return { ok: true };
  }

  async receipt(user: AuthUser, id: string): Promise<{ file: string; type: string }> {
    const inv = await this.invoiceFor(user, id);
    if (!inv.receipt_file) throw notFound('Receipt');
    const file = path.join(config.storageDir, 'receipts', path.basename(inv.receipt_file));
    if (!fs.existsSync(file)) throw notFound('Receipt');
    return { file, type: RECEIPT_TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream' };
  }

  /** Marks an invoice paid and extends (renewal) or enlarges (upgrade) the company's plan. */
  async markPaid(invoiceId: string, method: 'payway' | 'bank_transfer' | 'manual', actor: AuthUser | null, note: string | null, ip: string) {
    const done = await this.db.tx(async (tx) => {
      const inv = await tx.maybeOne('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
      if (!inv) throw notFound('Invoice');
      if (inv.status === 'paid') return null;
      if (inv.status === 'cancelled' && method !== 'payway') throw badRequest('This invoice was cancelled.', 'CANCELLED');
      const c = await tx.one('SELECT * FROM companies WHERE id = $1 FOR UPDATE', [inv.company_id]);
      const today = this.today();
      let start: string;
      let end: string;
      if (inv.kind === 'upgrade') {
        start = today;
        end = c.paid_until && c.paid_until >= today ? c.paid_until : addDaysIso(addMonthsIso(today, inv.months), -1);
        await tx.query('UPDATE companies SET tier_id = $2, paid_until = $3, updated_at = now() WHERE id = $1', [c.id, inv.tier_id, end]);
      } else {
        // Worked out again at payment time: the cover may have moved since the invoice was made.
        ({ start, end } = renewalPeriod({ exempt: false, trialEndsAt: c.trial_ends_at, paidUntil: c.paid_until }, today, inv.months));
        await tx.query('UPDATE companies SET tier_id = $2, paid_until = $3, updated_at = now() WHERE id = $1', [c.id, inv.tier_id, end]);
      }
      await tx.query(
        `UPDATE invoices SET status = 'paid', method = $2, paid_at = now(), period_start = $3, period_end = $4, reviewed_by = $5, review_note = $6, updated_at = now() WHERE id = $1`,
        [inv.id, method, start, end, actor?.id ?? null, note],
      );
      await this.audit.log({ companyId: c.id, userId: actor?.id ?? null, action: 'paid', module: 'invoices', recordId: inv.id, newValue: { number: inv.number, method, amount: inv.amount, paidUntil: end }, ip }, tx);
      return { inv, c, end };
    });
    if (done) this.notify(`✅ Payment received\n${done.c.name} (${done.c.code})\n${done.inv.number}: ${Number(done.inv.amount).toFixed(2)} USD by ${method.replace('_', ' ')}\nPaid until ${done.end}`);
    return { ok: true };
  }

  async reject(id: string, actor: AuthUser, note: string, ip: string) {
    const inv = await this.db.maybeOne('SELECT * FROM invoices WHERE id = $1', [id]);
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'submitted') throw badRequest('Only submitted transfers can be rejected.', 'NOT_SUBMITTED');
    await this.db.query(`UPDATE invoices SET status = 'rejected', reviewed_by = $2, review_note = $3, updated_at = now() WHERE id = $1`, [id, actor.id, note.trim()]);
    await this.audit.log({ companyId: inv.company_id, userId: actor.id, action: 'reject', module: 'invoices', recordId: id, newValue: { note }, ip });
    return { ok: true };
  }

  // ---------- super admin ----------

  async subscriptions() {
    const s = await this.settingsRow();
    const rows = await this.db.query(
      `SELECT c.*, t.min_staff, t.max_staff, t.monthly_price,
              (SELECT count(*) FROM employees e WHERE e.company_id = c.id AND e.status = 'active')::int AS staff_count,
              (SELECT count(*) FROM branches b WHERE b.company_id = c.id AND b.status = 'active')::int AS branch_count, t.max_branches,
              (SELECT count(*) FROM invoices i WHERE i.company_id = c.id AND i.status = 'submitted')::int AS to_check,
              (SELECT max(paid_at) FROM invoices i WHERE i.company_id = c.id AND i.status = 'paid') AS last_paid_at,
              (SELECT email FROM users u WHERE u.company_id = c.id AND u.role = 'company_admin' ORDER BY u.created_at LIMIT 1) AS admin_email
         FROM companies c LEFT JOIN price_tiers t ON t.id = c.tier_id
        ORDER BY c.created_at DESC`,
    );
    return rows.map((c) => ({
      id: c.id, name: c.name, code: c.code, status: c.status, createdAt: c.created_at, source: c.signup_source,
      contactName: c.contact_name, contactPhone: c.contact_phone, contactEmail: c.contact_email ?? c.admin_email, note: c.billing_note,
      exempt: c.billing_exempt, trialEndsAt: c.trial_ends_at, paidUntil: c.paid_until, staffCount: c.staff_count,
      branchCount: c.branch_count, branchLimit: this.branchLimitOf(c), branchLimitCustom: c.branch_limit_custom, customBranchLimit: c.branch_limit,
      tier: c.tier_id ? { id: c.tier_id, minStaff: c.min_staff, maxStaff: c.max_staff, monthlyPrice: Number(c.monthly_price), maxBranches: c.max_branches ?? null } : null,
      billing: this.statusOf(c, s.grace_days), toCheck: c.to_check, lastPaidAt: c.last_paid_at,
    }));
  }

  async adjustCompany(companyId: string, input: { exempt?: boolean; trialEndsAt?: string | null; paidUntil?: string | null; tierId?: string | null; note?: string | null; branchLimitCustom?: boolean; branchLimit?: number | null }, actor: AuthUser, ip: string) {
    const c = await this.companyRow(companyId);
    if (input.tierId) await this.tierById(input.tierId);
    const before = { exempt: c.billing_exempt, trialEndsAt: c.trial_ends_at, paidUntil: c.paid_until, tierId: c.tier_id, note: c.billing_note, branchLimitCustom: c.branch_limit_custom, branchLimit: c.branch_limit };
    const next = {
      exempt: input.exempt ?? before.exempt,
      trialEndsAt: input.trialEndsAt !== undefined ? input.trialEndsAt : before.trialEndsAt,
      paidUntil: input.paidUntil !== undefined ? input.paidUntil : before.paidUntil,
      tierId: input.tierId !== undefined ? input.tierId : before.tierId,
      note: input.note !== undefined ? input.note?.trim() || null : before.note,
      branchLimitCustom: input.branchLimitCustom ?? before.branchLimitCustom,
      branchLimit: input.branchLimit !== undefined ? input.branchLimit : before.branchLimit,
    };
    await this.db.query(
      `UPDATE companies SET billing_exempt = $2, trial_ends_at = $3, paid_until = $4, tier_id = $5, billing_note = $6, branch_limit_custom = $7, branch_limit = $8, updated_at = now()
        WHERE id = $1`,
      [companyId, next.exempt, next.trialEndsAt, next.paidUntil, next.tierId, next.note, next.branchLimitCustom, next.branchLimitCustom ? next.branchLimit : null],
    );
    const d = diff(before, next);
    await this.audit.log({ companyId, userId: actor.id, action: 'adjust', module: 'billing', recordId: companyId, oldValue: d.old, newValue: d.new, ip });
    return (await this.subscriptions()).find((x) => x.id === companyId);
  }

  async invoices(status?: string) {
    const rows = await this.db.query(
      `SELECT i.*, c.name AS company_name, c.code AS company_code, u.name AS reviewed_by_name, pa.name AS policy_accepted_by_name
         FROM invoices i JOIN companies c ON c.id = i.company_id LEFT JOIN users u ON u.id = i.reviewed_by LEFT JOIN users pa ON pa.id = i.policy_accepted_by
        WHERE ($1::text IS NULL OR i.status = $1)
        ORDER BY (i.status = 'submitted') DESC, i.created_at DESC LIMIT 300`,
      [status && status !== 'all' ? status : null],
    );
    return rows.map((r) => this.mapInvoice(r));
  }

  async pendingCount() {
    return Number((await this.db.one(`SELECT count(*) AS n FROM invoices WHERE status = 'submitted'`)).n);
  }

  /** Cash or other payments taken outside the app. */
  async recordPayment(companyId: string, input: { tierId: string; cycle: Cycle; amount?: number; note?: string }, actor: AuthUser, ip: string) {
    const inv = await this.createInvoice(companyId, input.tierId, input.cycle, actor, ip);
    if (input.amount !== undefined) await this.db.query('UPDATE invoices SET amount = $2 WHERE id = $1', [inv.id, input.amount]);
    await this.markPaid(inv.id, 'manual', actor, input.note?.trim() || 'Recorded by super admin', ip);
    return { ok: true, invoiceId: inv.id };
  }

  // ---------- sign-up ----------

  async codeAvailable(code: string) {
    if (!COMPANY_CODE.test(code)) return { available: false, valid: false };
    const r = await this.db.maybeOne('SELECT 1 FROM companies WHERE lower(code) = lower($1)', [code]);
    return { available: !r, valid: true };
  }

  /** A free code made from the company name (e.g. "Sok Mean Trading" -> "sokmean"). */
  async suggestCode(name: string): Promise<string> {
    const base = (name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'company').replace(/^[^a-z0-9]+/, '');
    const seed = base.length >= 2 ? base : `co${base}`;
    for (let i = 0; i < 50; i++) {
      const code = i === 0 ? seed : `${seed}${i + 1}`;
      if ((await this.codeAvailable(code)).available) return code;
    }
    return `${seed}${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }

  /** Creates the company with its admin, a default schedule and the free trial. Returns the admin's email to sign in with. */
  async signup(input: SignupInput, ip: string) {
    const s = await this.settingsRow();
    const tier = await this.tierById(input.tierId);
    const code = (input.companyCode?.trim() || (await this.suggestCode(input.companyName))).toLowerCase();
    if (!COMPANY_CODE.test(code)) throw badRequest('Company code must be 2-40 letters, numbers, - or _.', 'BAD_CODE');
    if (!(await this.codeAvailable(code)).available) throw conflict('That company code is already used. Choose another one.', 'CODE_TAKEN');
    const email = input.email.trim().toLowerCase();
    const phoneNorm = normalizePhone(input.phone);
    if (await this.db.maybeOne('SELECT 1 FROM users WHERE lower(email) = $1', [email])) throw conflict('An account with this email already exists. Sign in instead.', 'EMAIL_TAKEN');
    if (phoneNorm && (await this.db.maybeOne(`SELECT 1 FROM users WHERE phone_norm = $1 AND role <> 'employee'`, [phoneNorm]))) {
      throw conflict('An account with this phone number already exists. Sign in instead.', 'PHONE_TAKEN');
    }
    const today = this.today();
    const trialEnd = addDaysIso(addMonthsIso(today, s.trial_months), -1);
    const hash = await hashPassword(input.password);
    let company: any;
    try {
      company = await this.db.tx(async (tx) => {
        const c = await tx.one(
          `INSERT INTO companies (name, code, timezone, tier_id, trial_ends_at, signup_source, contact_name, contact_phone, contact_email)
           VALUES ($1, $2, 'Asia/Phnom_Penh', $3, $4, 'website', $5, $6, $7) RETURNING id, name, code`,
          [input.companyName.trim(), code, tier.id, trialEnd, input.fullName.trim(), input.phone.trim(), email],
        );
        await tx.query('INSERT INTO attendance_rules (company_id) VALUES ($1)', [c.id]);
        await tx.query(
          `INSERT INTO work_schedules (company_id, name, start_time, end_time, lunch_start, lunch_end, is_default) VALUES ($1, 'Office hours', '08:00', '17:00', '12:00', '13:00', true)`,
          [c.id],
        );
        const u = await tx.one(
          `INSERT INTO users (company_id, username, email, name, role, password_hash, must_change_password, phone, phone_norm)
           VALUES ($1, $2, $2, $3, 'company_admin', $4, false, $5, $6) RETURNING id`,
          [c.id, email, input.fullName.trim(), hash, input.phone.trim(), phoneNorm],
        );
        await this.audit.log({ companyId: c.id, userId: u.id, action: 'signup', module: 'companies', recordId: c.id, newValue: { name: c.name, code, email, tier: `${tier.minStaff}-${tier.maxStaff}`, trialEnd }, ip }, tx);
        return c;
      });
    } catch (e) {
      rethrowUnique(e, 'That company code or email is already used.');
    }
    this.notify(`🆕 New sign-up\n${company.name} (${code})\n${input.fullName} · ${input.phone} · ${email}\nPlan ${tier.minStaff}-${tier.maxStaff} staff · trial until ${trialEnd}`);
    return { companyId: company.id, companyCode: code, email, trialEndsAt: trialEnd };
  }

  /** New companies made by the super admin: free trial unless marked free. */
  async startTrial(companyId: string, exempt: boolean, tx: Queryable = this.db) {
    const s = await this.settingsRow(tx);
    const tiers = await this.tiers();
    await tx.query('UPDATE companies SET billing_exempt = $2, trial_ends_at = $3, tier_id = $4 WHERE id = $1', [
      companyId, exempt, exempt ? null : addDaysIso(addMonthsIso(this.today(), s.trial_months), -1), exempt ? null : tierFor(tiers, 1)?.id ?? null,
    ]);
  }

  // ---------- notifications ----------

  /** Telegram message to the super admin (optional; set the bot token and chat id in Platform settings). */
  notify(text: string) {
    this.settingsRow()
      .then(async (r) => {
        const token = openSecret(config.jwtSecret, r.telegram_bot_token);
        if (!token || !r.telegram_chat_id || config.isTest) return;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: r.telegram_chat_id, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10000),
        });
      })
      .catch((e) => this.log.warn(`Telegram notification failed: ${(e as Error).message}`));
  }

  /** Super admin: send a test Telegram message (errors are shown). */
  async testTelegram() {
    const r = await this.settingsRow();
    const token = openSecret(config.jwtSecret, r.telegram_bot_token);
    if (!token || !r.telegram_chat_id) throw badRequest('Enter the Telegram bot token and chat ID first.', 'TELEGRAM_NOT_SET');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: r.telegram_chat_id, text: '✅ MySoft QR and Phones Attendance: notifications work.' }), signal: AbortSignal.timeout(10000),
    }).catch((e) => ({ ok: false, json: async () => ({ description: (e as Error).message }) }) as any);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw badRequest(`Telegram said: ${j.description ?? 'error'}`, 'TELEGRAM_FAILED');
    return { ok: true };
  }

  assertSuper(user: AuthUser) {
    if (user.role !== 'super_admin') throw forbidden();
  }
}
