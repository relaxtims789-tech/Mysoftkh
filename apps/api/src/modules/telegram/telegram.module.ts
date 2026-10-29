import { Body, Controller, Get, Headers, HttpCode, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { config } from '../../config';
import { AllowPendingPasswordChange, AuthUser, clientIp, CurrentUser, Public, requireCompany, Roles, STAFF_ROLES } from '../../common/auth';
import { badRequest, forbidden, unauthorized } from '../../common/errors';
import { randomToken, sha256 } from '../../common/crypto';
import { verifyInitData, VerifiedInitData } from '../../common/telegram-init-data';
import { Db } from '../../database/db.service';
import { timeToMinutes } from '../../domain/time';
import { AttendanceModule } from '../attendance/attendance.module';
import { AttendanceSummaryService, countStatuses } from '../attendance/summary.service';
import { AuditService } from '../audit/audit.service';
import { meta, setRefreshCookie } from '../auth/auth.controller';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { CompanyContextService } from '../core/company-context.service';
import { adminMessages, LIVE, MANAGE_APP, OPEN_APP, tgMessages } from '../core/telegram-messages';
import { ADMIN_ALERTS, AdminAlert, Bilingual, BotKind, TelegramService } from '../core/telegram.service';
import { TelegramGroupsController, TelegramGroupsService } from './telegram-groups';

const BOTS = ['staff', 'admin'] as const;

class InitDataDto {
  @ApiProperty({ description: 'window.Telegram.WebApp.initData' }) @IsString() @MinLength(10) @MaxLength(8192) initData: string;
  @ApiPropertyOptional({ enum: BOTS, description: 'Which bot opened the Mini App (staff = /app, admin = /manage)' }) @IsOptional() @IsIn(BOTS) bot?: BotKind;
}
class NotifyDto {
  @IsBoolean() notify: boolean;
}
class AdminAlertsDto {
  @IsOptional() @IsBoolean() notify?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(ADMIN_ALERTS, { each: true }) alerts?: AdminAlert[];
}
class SummaryTimeDto {
  @ApiProperty({ example: '09:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Time must be HH:MM.' }) time: string;
}

const TICK_MS = 5 * 60 * 1000;
/** Minutes after the end of work before "you have not checked out" is sent. */
const REMIND_AFTER_MINUTES = 60;
/** The "not checked in yet" list goes out this long after the default schedule's late time. */
const ABSENT_AFTER_MINUTES = 30;
const ADMIN_ROLES_TG = ['super_admin', 'company_admin', 'hr', 'manager'];

const BOT_COLUMNS: Record<BotKind, { username: string; secret: string; setupAt: string }> = {
  staff: { username: 'telegram_bot_username', secret: 'telegram_webhook_secret', setupAt: 'telegram_setup_at' },
  admin: { username: 'telegram_admin_bot_username', secret: 'telegram_admin_webhook_secret', setupAt: 'telegram_admin_setup_at' },
};

/**
 * Telegram Mini Apps. Two bots: staff open /app from the staff bot; admins, HR and managers open /manage from the admin
 * bot. Sign-in with Telegram's signed launch data after linking once, linking from the browser via /start <code>, the
 * bots' webhooks and set-up, check-out reminders (staff bot) and the daily admin alerts (admin bot).
 */
@Injectable()
export class TelegramAppService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TelegramApp');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly tg: TelegramService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly ctx: CompanyContextService,
    private readonly summaries: AttendanceSummaryService,
    private readonly groups: TelegramGroupsService,
  ) {}

  onModuleInit() {
    if (config.isTest) return;
    this.timer = setInterval(() => {
      const now = new Date();
      this.sendCheckoutReminders(now).catch((e) => this.log.warn(`Reminders failed: ${(e as Error).message}`));
      this.sendDailyAlerts(now).catch((e) => this.log.warn(`Daily alerts failed: ${(e as Error).message}`));
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async verify(initData: string, bot: BotKind): Promise<VerifiedInitData> {
    const token = await this.tg.botToken(bot);
    if (!token) throw badRequest('Telegram is not set up yet.', 'TELEGRAM_NOT_SET');
    const v = verifyInitData(initData, token);
    if (!v) throw unauthorized('Please close and open the app again from the Telegram bot.', 'TELEGRAM_INVALID');
    return v;
  }

  private async botUsername(bot: BotKind): Promise<string | null> {
    return (await this.db.one(`SELECT ${BOT_COLUMNS[bot].username} AS u FROM platform_settings WHERE id = 1`)).u;
  }

  /** The admin bot is only for admins, HR and managers. */
  private async assertAllowed(bot: BotKind, role: string) {
    if (bot === 'admin' && !ADMIN_ROLES_TG.includes(role)) {
      const staff = await this.botUsername('staff');
      throw forbidden(`This app is for admins, HR and managers.${staff ? ` Staff use @${staff}.` : ''}`, 'TELEGRAM_ADMIN_ONLY');
    }
  }

  /** Mini App start: signs in the account linked to this Telegram user (401 TELEGRAM_NOT_LINKED when none). */
  async login(initData: string, bot: BotKind, m: { ip: string; userAgent: string }) {
    const v = await this.verify(initData, bot);
    const u = await this.db.maybeOne('SELECT id, role FROM users WHERE telegram_user_id = $1', [v.user.id]);
    if (!u) throw unauthorized('Sign in once to connect your Telegram.', 'TELEGRAM_NOT_LINKED');
    await this.assertAllowed(bot, u.role);
    await this.db.query('UPDATE users SET telegram_username = $2, telegram_lang = $3 WHERE id = $1', [u.id, v.user.username ?? null, v.user.language_code ?? null]);
    return this.auth.loginAsUser(u.id, `telegram_${bot}`, m);
  }

  private async linkTelegram(userId: string, tgUser: { id: number; username?: string; language_code?: string }, bot: BotKind, how: string, ip: string) {
    const u = await this.db.tx(async (tx) => {
      const other = await tx.maybeOne('SELECT id FROM users WHERE telegram_user_id = $1 AND id <> $2', [tgUser.id, userId]);
      if (other) await tx.query('UPDATE users SET telegram_user_id = NULL, telegram_linked_at = NULL WHERE id = $1', [other.id]);
      const row = await tx.one(
        `UPDATE users SET telegram_user_id = $2, telegram_username = $3, telegram_lang = $4, telegram_linked_at = now(),
                telegram_notify = CASE WHEN $5 = 'staff' THEN true ELSE telegram_notify END,
                telegram_admin_notify = CASE WHEN $5 = 'admin' THEN true ELSE telegram_admin_notify END
          WHERE id = $1 RETURNING id, name, role, company_id`,
        [userId, tgUser.id, tgUser.username ?? null, tgUser.language_code ?? null, bot],
      );
      await this.audit.log({ companyId: row.company_id, userId, action: 'link', module: 'telegram', recordId: userId, newValue: { bot, how, telegramUsername: tgUser.username ?? null, movedFromUser: other?.id ?? null }, ip }, tx);
      return row;
    });
    const company = u.company_id ? (await this.db.maybeOne('SELECT name FROM companies WHERE id = $1', [u.company_id]))?.name : null;
    await this.tg.sendTo(tgUser.id, tgMessages.linked(u.name, company), tgUser.language_code ?? null, [bot === 'admin' ? MANAGE_APP : OPEN_APP], bot);
  }

  async link(user: AuthUser, initData: string, bot: BotKind, ip: string) {
    await this.assertAllowed(bot, user.role);
    const v = await this.verify(initData, bot);
    await this.linkTelegram(user.id, v.user, bot, 'mini_app', ip);
    return this.status(user);
  }

  async unlink(user: AuthUser, ip: string) {
    await this.db.query('UPDATE users SET telegram_user_id = NULL, telegram_linked_at = NULL WHERE id = $1', [user.id]);
    await this.audit.log({ companyId: user.companyId, userId: user.id, action: 'unlink', module: 'telegram', recordId: user.id, ip });
    return this.status(user);
  }

  async setNotify(user: AuthUser, notify: boolean) {
    await this.db.query('UPDATE users SET telegram_notify = $2 WHERE id = $1', [user.id, notify]);
    return this.status(user);
  }

  async status(user: AuthUser) {
    const [u, s, staffToken, adminToken] = await Promise.all([
      this.db.one('SELECT telegram_user_id, telegram_username, telegram_notify, telegram_admin_notify, telegram_admin_alerts, telegram_linked_at FROM users WHERE id = $1', [user.id]),
      this.db.one('SELECT telegram_bot_username, telegram_admin_bot_username FROM platform_settings WHERE id = 1'),
      this.tg.botToken('staff'),
      this.tg.botToken('admin'),
    ]);
    return {
      available: !!(s.telegram_bot_username && staffToken),
      botUsername: s.telegram_bot_username,
      adminAvailable: !!(s.telegram_admin_bot_username && adminToken),
      adminBotUsername: s.telegram_admin_bot_username,
      linked: !!u.telegram_user_id,
      username: u.telegram_username,
      notify: u.telegram_notify,
      adminNotify: u.telegram_admin_notify,
      adminAlerts: u.telegram_admin_alerts as AdminAlert[],
      linkedAt: u.telegram_linked_at,
    };
  }

  async setAdminAlerts(user: AuthUser, input: { notify?: boolean; alerts?: AdminAlert[] }) {
    if (!ADMIN_ROLES_TG.includes(user.role)) throw forbidden();
    if (input.notify !== undefined) await this.db.query('UPDATE users SET telegram_admin_notify = $2 WHERE id = $1', [user.id, input.notify]);
    if (input.alerts) await this.db.query('UPDATE users SET telegram_admin_alerts = $2 WHERE id = $1', [user.id, [...new Set(input.alerts)]]);
    return this.status(user);
  }

  async summaryTime(companyId: string) {
    const r = await this.db.maybeOne(`SELECT to_char(telegram_summary_time, 'HH24:MI') AS t FROM attendance_rules WHERE company_id = $1`, [companyId]);
    return { time: r?.t ?? '09:00' };
  }

  async setSummaryTime(user: AuthUser, time: string, ip: string) {
    const companyId = requireCompany(user);
    await this.db.query('UPDATE attendance_rules SET telegram_summary_time = $2 WHERE company_id = $1', [companyId, time]);
    await this.audit.log({ companyId, userId: user.id, action: 'update', module: 'telegram', recordId: 'summary_time', newValue: { time }, ip });
    return { time };
  }

  /** Browser: a t.me link that connects this account when the user presses Start in the bot. */
  async connectLink(user: AuthUser, bot: BotKind) {
    await this.assertAllowed(bot, user.role);
    const st = await this.status(user);
    const username = bot === 'admin' ? st.adminBotUsername : st.botUsername;
    if (!(bot === 'admin' ? st.adminAvailable : st.available) || !username) throw badRequest('Telegram is not set up yet. Ask your administrator.', 'TELEGRAM_NOT_SET');
    const token = randomToken(24);
    await this.db.query(`DELETE FROM telegram_link_tokens WHERE user_id = $1 OR expires_at < now()`, [user.id]);
    await this.db.query(`INSERT INTO telegram_link_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '15 minutes')`, [sha256(token), user.id]);
    return { url: `https://t.me/${username}?start=${token}` };
  }

  /** Telegram calls this for messages to a bot (only with that bot's secret header). */
  async webhook(bot: BotKind, secret: string | undefined, update: any) {
    const s = await this.db.one(`SELECT ${BOT_COLUMNS[bot].secret} AS secret FROM platform_settings WHERE id = 1`);
    const expected: string = s.secret ?? '';
    if (!expected || !secret || secret.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
      throw unauthorized('Bad webhook secret.', 'BAD_SECRET');
    }
    if (await this.groups.handleUpdate(bot, update)) return { ok: true };
    const msg = update?.message;
    if (!msg?.from?.id || msg.chat?.type !== 'private' || typeof msg.text !== 'string') return { ok: true };
    const lang: string | null = msg.from.language_code ?? null;
    const welcome = () => this.tg.sendTo(msg.chat.id, bot === 'admin' ? adminMessages.welcome : tgMessages.welcome, lang, [bot === 'admin' ? MANAGE_APP : OPEN_APP], bot);
    const m = /^\/start(?:\s+([A-Za-z0-9_-]{8,64}))?/.exec(msg.text.trim());
    if (!m?.[1]) {
      await welcome();
      return { ok: true };
    }
    const row = await this.db.maybeOne(
      `DELETE FROM telegram_link_tokens t USING users u WHERE t.token_hash = $1 AND u.id = t.user_id RETURNING t.user_id, t.expires_at, u.role`,
      [sha256(m[1])],
    );
    if (!row || new Date(row.expires_at) < new Date() || (bot === 'admin' && !ADMIN_ROLES_TG.includes(row.role))) {
      await this.tg.sendTo(msg.chat.id, tgMessages.linkExpired, lang, [], bot);
      return { ok: true };
    }
    await this.linkTelegram(row.user_id, msg.from, bot, 'bot_start', 'telegram');
    return { ok: true };
  }

  /** Super admin: points a bot at this server (webhook), adds its menu button and /start command. */
  async setup(actor: AuthUser, bot: BotKind, ip: string) {
    this.tg.forgetToken();
    if (!(await this.tg.botToken(bot))) throw badRequest(`Enter and save the ${bot === 'admin' ? 'admin' : 'staff'} bot token first.`, 'TELEGRAM_NOT_SET');
    if (!config.publicUrl.startsWith('https://')) throw badRequest('Telegram Mini Apps need an https address. Set it up on the server, not on a local PC.', 'NEEDS_HTTPS');
    const me = await this.tg.call('getMe', {}, bot);
    if (!me?.ok) throw badRequest(`Telegram said: ${me?.description ?? 'no answer'}. Check the bot token.`, 'TELEGRAM_FAILED');
    const other = await this.botUsername(bot === 'admin' ? 'staff' : 'admin');
    if (other && other === me.result.username) throw badRequest('Use two different bots: one for staff and one for admins.', 'SAME_BOT');
    const cols = BOT_COLUMNS[bot];
    const s = await this.db.one(`SELECT ${cols.secret} AS secret FROM platform_settings WHERE id = 1`);
    const secret = s.secret || randomToken(32);
    const base = config.publicUrl.replace(/\/$/, '');
    const isAdmin = bot === 'admin';
    const steps: { step: string; ok: boolean; description?: string }[] = [];
    const run = async (step: string, method: string, body: object) => {
      const r = await this.tg.call(method, body, bot);
      steps.push({ step, ok: !!r?.ok, description: r?.ok ? undefined : r?.description });
    };
    await run('Webhook (bot replies to /start)', 'setWebhook', {
      url: `${base}/api/public/telegram/${isAdmin ? 'admin-webhook' : 'webhook'}`, secret_token: secret, allowed_updates: ['message', 'my_chat_member'], drop_pending_updates: true,
    });
    await run(`Menu button "${isAdmin ? 'Admin' : 'Attendance'}"`, 'setChatMenuButton', {
      menu_button: { type: 'web_app', text: isAdmin ? 'Admin' : 'Attendance', web_app: { url: `${base}${isAdmin ? '/manage' : '/app'}` } },
    });
    await run('/start command', 'setMyCommands', { commands: [{ command: 'start', description: isAdmin ? 'Open the admin app' : 'Open the attendance app' }] });
    await run('/start command (Khmer)', 'setMyCommands', { commands: [{ command: 'start', description: isAdmin ? 'បើកកម្មវិធីគ្រប់គ្រង' : 'បើកកម្មវិធីវត្តមាន' }], language_code: 'km' });
    await run('Bot description', 'setMyDescription', {
      description: isAdmin
        ? 'MySoft Attendance for admins, HR and managers: today\'s attendance, approvals, morning summary and alerts. Tap Start, then Admin.'
        : 'MySoft Attendance: check in and out with your phone, see your history, leave and payslips. Tap Start, then Attendance.',
    });
    await run('Bot description (Khmer)', 'setMyDescription', {
      description: isAdmin
        ? 'MySoft Attendance សម្រាប់អ្នកគ្រប់គ្រង HR និងប្រធានផ្នែក៖ វត្តមានថ្ងៃនេះ ការអនុម័ត សេចក្តីសង្ខេបពេលព្រឹក និងការជូនដំណឹង។ ចុច Start រួចចុច Admin។'
        : 'MySoft Attendance៖ ចុះវត្តមានចូល និងចេញដោយទូរស័ព្ទ មើលប្រវត្តិ ច្បាប់ និងប្រាក់ខែ។ ចុច Start រួចចុច Attendance។',
      language_code: 'km',
    });
    await this.db.query(
      `UPDATE platform_settings SET ${cols.username} = $1, ${cols.secret} = $2, ${cols.setupAt} = now(), updated_at = now() WHERE id = 1`,
      [me.result.username, secret],
    );
    await this.audit.log({ companyId: null, userId: actor.id, action: 'setup', module: 'telegram', newValue: { bot, username: me.result.username, steps }, ip });
    return { ok: steps.every((x) => x.ok), bot, botUsername: me.result.username, botLink: `https://t.me/${me.result.username}`, appUrl: `${base}${isAdmin ? '/manage' : '/app'}`, steps };
  }

  /**
   * Staff bot: linked employees who checked in today but not out, an hour after the end of their working time, get one
   * reminder.
   */
  async sendCheckoutReminders(now = new Date()) {
    if (!(await this.tg.botToken('staff'))) return { sent: 0 };
    const rows = await this.db.query(
      `SELECT u.employee_id, e.company_id FROM users u JOIN employees e ON e.id = u.employee_id JOIN companies c ON c.id = e.company_id
        WHERE u.telegram_user_id IS NOT NULL AND u.telegram_notify AND u.status = 'active' AND e.status = 'active' AND c.status = 'active'`,
    );
    const byCompany = new Map<string, string[]>();
    for (const r of rows) byCompany.set(r.company_id, [...(byCompany.get(r.company_id) ?? []), r.employee_id]);
    let sent = 0;
    for (const [companyId, employeeIds] of byCompany) {
      const company = await this.ctx.get(companyId);
      const local = this.ctx.now(company.timezone, now);
      const built = await this.summaries.build(companyId, local.date, local.date, null, { employeeIds });
      for (const e of built.employees) {
        const d = built.days.get(e.id)?.[0];
        const schedule = (e.scheduleId && built.schedules.get(e.scheduleId)) || built.schedules.get('') || null;
        if (!d?.checkIn || d.checkOut || !schedule) continue;
        if (local.minutes < timeToMinutes(schedule.endTime) + REMIND_AFTER_MINUTES) continue;
        const ins = await this.db.maybeOne(
          'INSERT INTO telegram_reminders (employee_id, work_date) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING employee_id',
          [e.id, local.date],
        );
        if (!ins) continue;
        const checkInTime = this.ctx.now(company.timezone, new Date(d.checkIn)).time;
        this.tg.notifyEmployee(e.id, tgMessages.reminder(checkInTime), [{ text: { en: '📲 Check out now', km: '📲 ចុះវត្តមានចេញឥឡូវ' }, path: '/app' }]);
        sent++;
      }
    }
    return { sent };
  }

  /**
   * Admin bot, once a day per company: the "not checked in yet" list (30 min after the default schedule's late time)
   * and the morning summary (at the company's summary time). Managers get only their departments.
   */
  async sendDailyAlerts(now = new Date()) {
    if (!(await this.tg.botToken('admin'))) return { summary: 0, absent: 0 };
    const companies = await this.db.query(
      `SELECT DISTINCT u.company_id FROM users u JOIN companies c ON c.id = u.company_id
        WHERE u.telegram_user_id IS NOT NULL AND u.telegram_admin_notify AND u.status = 'active' AND c.status = 'active'
          AND u.role IN ('company_admin', 'hr', 'manager')`,
    );
    const out = { summary: 0, absent: 0 };
    for (const { company_id: companyId } of companies) {
      const company = await this.ctx.get(companyId);
      const local = this.ctx.now(company.timezone, now);
      const [rules, schedules] = await Promise.all([
        this.db.maybeOne(`SELECT to_char(telegram_summary_time, 'HH24:MI') AS t FROM attendance_rules WHERE company_id = $1`, [companyId]),
        this.ctx.schedules(companyId),
      ]);
      const def = schedules.get('');
      const absentAt = def ? timeToMinutes(def.startTime) + def.lateAfterMinutes + ABSENT_AFTER_MINUTES : null;
      const summaryAt = timeToMinutes(rules?.t ?? '09:00');
      const dueAbsent = absentAt !== null && local.minutes >= absentAt;
      const dueSummary = local.minutes >= summaryAt;
      if (!dueAbsent && !dueSummary) continue;
      const claim = async (kind: string) => !!(await this.db.maybeOne(
        'INSERT INTO telegram_daily_alerts (company_id, kind, work_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING kind', [companyId, kind, local.date],
      ));
      const wantAbsent = dueAbsent && (await claim('absent'));
      const wantSummary = dueSummary && (await claim('summary'));
      if (!wantAbsent && !wantSummary) continue;

      const built = await this.summaries.build(companyId, local.date, local.date, null);
      const people = built.employees.map((e) => ({ e, d: built.days.get(e.id)?.[0] })).filter((x) => !!x.d) as { e: (typeof built.employees)[number]; d: NonNullable<ReturnType<typeof built.days.get>>[number] }[];
      const forRecipient = (deps: string[] | null) => (deps ? people.filter((p) => p.e.departmentId && deps.includes(p.e.departmentId)) : people);
      const names = (list: typeof people) => list.map((p) => `${p.e.name} (${p.e.employeeCode})`);

      if (wantAbsent) {
        const any = people.some((p) => p.d.status === 'absent');
        if (any) {
          this.tg.alertAdmins(companyId, 'late_absent', undefined, (r): Bilingual | null => {
            const absent = forRecipient(r.departmentIds).filter((p) => p.d.status === 'absent');
            return absent.length ? adminMessages.absent(local.date, names(absent)) : null;
          }, [LIVE]);
          out.absent++;
        }
      }
      if (wantSummary) {
        const scheduled = people.filter((p) => p.d.status !== 'day_off' && p.d.status !== 'holiday');
        if (scheduled.length) {
          this.tg.alertAdmins(companyId, 'summary', undefined, (r): Bilingual | null => {
            const mine = forRecipient(r.departmentIds);
            const c = countStatuses(mine.map((p) => p.d));
            const sched = c.total - c.dayOff - c.holiday;
            if (!sched) return null;
            const late = mine.filter((p) => p.d.status === 'late').map((p) => `${p.e.name} (${p.d.lateMinutes} min)`);
            const absent = names(mine.filter((p) => p.d.status === 'absent'));
            return adminMessages.summary(local.date, { scheduled: sched, present: c.present, late: c.late, absent: c.absent, leave: c.leave, notYet: c.notYet }, late, absent);
          }, [LIVE]);
          out.summary++;
        }
      }
    }
    return out;
  }
}

@ApiTags('Telegram')
@Controller('auth/telegram')
export class TelegramAuthController {
  constructor(private readonly app: TelegramAppService, private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Mini App: sign in with Telegram launch data (account linked once). 401 TELEGRAM_NOT_LINKED = sign in with a password first.' })
  async login(@Body() dto: InitDataDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.app.login(dto.initData, dto.bot ?? 'staff', meta(req));
    setRefreshCookie(res, s);
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, user: await this.auth.profileFor(s.userId) };
  }

  @Get('status')
  @ApiBearerAuth()
  @AllowPendingPasswordChange()
  status(@CurrentUser() u: AuthUser) {
    return this.app.status(u);
  }

  @Post('link')
  @HttpCode(200)
  @ApiBearerAuth()
  @AllowPendingPasswordChange()
  @ApiOperation({ summary: 'Mini App: connect this Telegram account to the signed-in user (next time it signs in by itself).' })
  link(@Body() dto: InitDataDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.app.link(u, dto.initData, dto.bot ?? 'staff', clientIp(req));
  }

  @Post('unlink')
  @HttpCode(200)
  @ApiBearerAuth()
  unlink(@CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.app.unlink(u, clientIp(req));
  }

  @Put('notify')
  @ApiBearerAuth()
  notify(@Body() dto: NotifyDto, @CurrentUser() u: AuthUser) {
    return this.app.setNotify(u, dto.notify);
  }

  @Put('admin-alerts')
  @ApiBearerAuth()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Admin bot: alerts on/off and which ones (requests, summary, late_absent, rejected).' })
  adminAlerts(@Body() dto: AdminAlertsDto, @CurrentUser() u: AuthUser) {
    return this.app.setAdminAlerts(u, dto);
  }

  @Get('summary-time')
  @ApiBearerAuth()
  @Roles(...STAFF_ROLES)
  summaryTime(@CurrentUser() u: AuthUser) {
    return this.app.summaryTime(requireCompany(u));
  }

  @Put('summary-time')
  @ApiBearerAuth()
  @Roles('super_admin', 'company_admin')
  @ApiOperation({ summary: 'Time of the morning summary (company time zone).' })
  setSummaryTime(@Body() dto: SummaryTimeDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.app.setSummaryTime(u, dto.time, clientIp(req));
  }

  @Post('connect-link')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Browser: a t.me link that connects Telegram when the user presses Start in the bot (bot=staff|admin).' })
  connect(@CurrentUser() u: AuthUser, @Query('bot') bot?: string) {
    return this.app.connectLink(u, bot === 'admin' ? 'admin' : 'staff');
  }
}

@ApiTags('Telegram')
@Controller()
export class TelegramBotController {
  constructor(private readonly app: TelegramAppService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('public/telegram/webhook')
  @HttpCode(200)
  webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: any) {
    return this.app.webhook('staff', secret, update);
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('public/telegram/admin-webhook')
  @HttpCode(200)
  adminWebhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: any) {
    return this.app.webhook('admin', secret, update);
  }

  @Post('platform/telegram/setup')
  @HttpCode(200)
  @Roles('super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Super admin: connect a bot to this server (webhook, menu button, /start). bot=staff|admin' })
  setup(@CurrentUser() u: AuthUser, @Req() req: Request, @Query('bot') bot?: string) {
    return this.app.setup(u, bot === 'admin' ? 'admin' : 'staff', clientIp(req));
  }
}

@Module({
  imports: [AuthModule, AttendanceModule],
  controllers: [TelegramAuthController, TelegramBotController, TelegramGroupsController],
  providers: [TelegramAppService, TelegramGroupsService],
  exports: [TelegramAppService],
})
export class TelegramModule {}
