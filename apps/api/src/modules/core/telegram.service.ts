import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';
import { openSecret } from '../../common/crypto';
import { Db } from '../../database/db.service';

/** A message in English and Khmer; the reader's Telegram language picks one. */
export interface Bilingual {
  en: string;
  km: string;
}

export interface TgButton {
  text: Bilingual;
  /** App path opened inside Telegram as a Mini App, e.g. /app/payslips/2026-09 or /manage/approvals. */
  path: string;
}

/** staff = the employees' bot (Mini App /app); admin = the admins' / HR / managers' bot (Mini App /manage). */
export type BotKind = 'staff' | 'admin';
export type AdminAlert = 'requests' | 'summary' | 'late_absent' | 'rejected';
export const ADMIN_ALERTS: AdminAlert[] = ['requests', 'summary', 'late_absent', 'rejected'];
/** What a company's Telegram group can receive. */
export type GroupEvent = 'check_in' | 'check_out' | 'leave' | 'correction';
export const GROUP_EVENTS: GroupEvent[] = ['check_in', 'check_out', 'leave', 'correction'];
/** A link button under a group message (Mini App buttons only work in private chats). */
export interface TgLink { text: Bilingual; path: string }

export interface AlertRecipient {
  userId: string;
  role: string;
  lang: string | null;
  /** Departments a manager sees; null = the whole company. */
  departmentIds: string[] | null;
}

type Transport = (method: string, body: object, bot: BotKind) => Promise<any>;

const TOKEN_COLUMN: Record<BotKind, string> = { staff: 'telegram_bot_token', admin: 'telegram_admin_bot_token' };

/**
 * Sends Telegram messages with the platform bots (tokens in Platform settings). Never throws: a message that cannot be
 * sent must not break the action that triggered it. Tests replace `transport` / read `sent`.
 */
@Injectable()
export class TelegramService {
  private readonly log = new Logger('Telegram');
  private tokenCache = new Map<BotKind, { token: string | null; at: number }>();
  /** Messages sent while testing (config.isTest). */
  readonly sent: { bot: BotKind; method: string; body: any }[] = [];

  transport: Transport = async (method, body, bot) => {
    const token = await this.botToken(bot);
    if (!token) return { ok: false, description: 'bot token not set' };
    if (config.isTest) {
      this.sent.push({ bot, method, body });
      return { ok: true, result: { message_id: this.sent.length } };
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  };

  constructor(private readonly db: Db) {}

  async botToken(bot: BotKind = 'staff'): Promise<string | null> {
    const c = this.tokenCache.get(bot);
    if (c && Date.now() - c.at < 30_000) return c.token;
    const r = await this.db.maybeOne(`SELECT ${TOKEN_COLUMN[bot]} AS token FROM platform_settings WHERE id = 1`);
    const token = openSecret(config.jwtSecret, r?.token);
    this.tokenCache.set(bot, { token, at: Date.now() });
    return token;
  }

  forgetToken() {
    this.tokenCache.clear();
  }

  async call(method: string, body: object = {}, bot: BotKind = 'staff'): Promise<any> {
    try {
      return await this.transport(method, body, bot);
    } catch (e) {
      return { ok: false, description: (e as Error).message };
    }
  }

  /** Inline buttons that open the app inside Telegram. */
  webAppMarkup(buttons: TgButton[], lang: string | null) {
    const base = config.publicUrl.replace(/\/$/, '');
    return { inline_keyboard: buttons.map((b) => [{ text: pick(b.text, lang), web_app: { url: `${base}${b.path}` } }]) };
  }

  async sendTo(chatId: number | string, text: Bilingual, lang: string | null, buttons: TgButton[] = [], bot: BotKind = 'staff') {
    return this.call('sendMessage', {
      chat_id: chatId,
      text: pick(text, lang),
      disable_web_page_preview: true,
      ...(buttons.length ? { reply_markup: this.webAppMarkup(buttons, lang) } : {}),
    }, bot);
  }

  /** Staff bot: to the employee's linked Telegram (if notifications are on). */
  notifyEmployee(employeeId: string, text: Bilingual, buttons: TgButton[] = []) {
    this.run(async () => {
      if (!(await this.botToken('staff'))) return;
      const rows = await this.db.query(
        `SELECT u.telegram_user_id, u.telegram_lang FROM users u
          WHERE u.employee_id = $1 AND u.telegram_user_id IS NOT NULL AND u.telegram_notify AND u.status = 'active'`,
        [employeeId],
      );
      for (const u of rows) await this.sendTo(u.telegram_user_id, text, u.telegram_lang, buttons, 'staff');
    });
  }

  /**
   * Admin bot: to the company's admins, HR and managers who linked Telegram and want this kind of alert.
   * `departmentId` (the employee's department) limits managers to their departments; undefined = company-wide.
   * `text` may return null to skip a recipient (e.g. a manager with nothing in their departments).
   */
  alertAdmins(companyId: string, kind: AdminAlert, departmentId: string | null | undefined,
    text: Bilingual | ((r: AlertRecipient) => Bilingual | null), buttons: TgButton[] = []) {
    this.run(async () => {
      for (const r of await this.adminRecipients(companyId, kind)) {
        if (departmentId !== undefined && r.departmentIds && (!departmentId || !r.departmentIds.includes(departmentId))) continue;
        const msg = typeof text === 'function' ? text(r) : text;
        if (msg) await this.sendTo(r.chatId, msg, r.lang, buttons, 'admin');
      }
    });
  }

  /**
   * The company's Telegram groups that want this event (and this branch). Each group gets the text in its language;
   * a group the bot was removed from is switched off, and an upgraded group (supergroup) is followed to its new id.
   */
  notifyGroups(companyId: string, event: GroupEvent, branchId: string | null, text: Bilingual, link?: TgLink) {
    this.run(async () => {
      const groups = await this.db.query(
        `SELECT id, chat_id, bot, lang FROM telegram_groups
          WHERE company_id = $1 AND active AND $2 = ANY(events) AND (branch_id IS NULL OR branch_id = $3)`,
        [companyId, event, branchId],
      );
      for (const g of groups) await this.sendGroup(g, text, link);
    });
  }

  /** One message to one group; returns Telegram's answer. */
  async sendGroup(g: { id: string; chat_id: string | number; bot: BotKind; lang: string }, text: Bilingual, link?: TgLink): Promise<any> {
    const body = (chatId: string | number) => ({
      chat_id: chatId,
      text: g.lang === 'both' ? `${text.km}\n\n${text.en}` : pick(text, g.lang),
      disable_web_page_preview: true,
      ...(link ? { reply_markup: { inline_keyboard: [[{ text: g.lang === 'en' ? link.text.en : link.text.km, url: `${config.publicUrl.replace(/\/$/, '')}${link.path}` }]] } } : {}),
    });
    let r = await this.call('sendMessage', body(g.chat_id), g.bot);
    const moved = r?.parameters?.migrate_to_chat_id;
    if (!r?.ok && moved) {
      await this.db.query('UPDATE telegram_groups SET chat_id = $2 WHERE id = $1', [g.id, moved]);
      r = await this.call('sendMessage', body(moved), g.bot);
    }
    if (!r?.ok && /kicked|not a member|chat not found|bot was blocked|have no rights|CHAT_WRITE_FORBIDDEN|Forbidden/i.test(r?.description ?? '')) {
      await this.db.query('UPDATE telegram_groups SET active = false, status_note = $2 WHERE id = $1', [g.id, `Telegram: ${r.description}`]);
    }
    return r;
  }

  async adminRecipients(companyId: string, kind: AdminAlert): Promise<(AlertRecipient & { chatId: number })[]> {
    if (!(await this.botToken('admin'))) return [];
    const rows = await this.db.query(
      `SELECT u.id, u.role, u.telegram_user_id, u.telegram_lang,
              (SELECT array_agg(md.department_id) FROM manager_departments md WHERE md.user_id = u.id) AS dept_ids
         FROM users u
        WHERE u.company_id = $1 AND u.role IN ('company_admin', 'hr', 'manager') AND u.status = 'active'
          AND u.telegram_user_id IS NOT NULL AND u.telegram_admin_notify AND $2 = ANY(u.telegram_admin_alerts)`,
      [companyId, kind],
    );
    return rows.map((u) => ({
      userId: u.id, role: u.role, lang: u.telegram_lang, chatId: Number(u.telegram_user_id),
      departmentIds: u.role === 'manager' ? (u.dept_ids ?? []) : null,
    }));
  }

  private run(fn: () => Promise<void>) {
    fn().catch((e) => this.log.warn(`Telegram message failed: ${(e as Error).message}`));
  }
}

export const pick = (t: Bilingual, lang: string | null) => (lang?.toLowerCase().startsWith('km') ? t.km : t.en);

/** "07:58" -> "07:58 AM" */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-10-06" -> "6 Oct 2026" */
export function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
