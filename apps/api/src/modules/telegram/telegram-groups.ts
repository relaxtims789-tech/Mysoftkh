import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import { AuthUser, clientIp, CurrentUser, requireCompany, Roles } from '../../common/auth';
import { badRequest, notFound } from '../../common/errors';
import { randomToken, sha256 } from '../../common/crypto';
import { Db } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';
import { groupMessages } from '../core/telegram-messages';
import { BotKind, GROUP_EVENTS, GroupEvent, TelegramService } from '../core/telegram.service';

const GROUP_CHATS = ['group', 'supergroup'];
const CODE_MINUTES = 30;

class GroupDto {
  @ApiPropertyOptional({ enum: GROUP_EVENTS, isArray: true, description: 'What the group receives' })
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(GROUP_EVENTS, { each: true }) events?: GroupEvent[];
  @ApiPropertyOptional({ enum: ['km', 'en', 'both'] }) @IsOptional() @IsIn(['km', 'en', 'both']) lang?: 'km' | 'en' | 'both';
  @ApiPropertyOptional({ description: 'Only this branch; null = every branch', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() branchId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

const mapGroup = (g: any) => ({
  id: g.id, title: g.title, events: g.events, lang: g.lang, branchId: g.branch_id, branchName: g.branch_name ?? null,
  active: g.active, statusNote: g.status_note, bot: g.bot, createdAt: g.created_at,
});

/**
 * A company's Telegram groups. The admin presses "Connect a Telegram group", which opens t.me/<bot>?startgroup=<code>:
 * Telegram asks which group, adds the bot and posts /start <code> there, and the webhook links that group to the company.
 * The group then gets check-ins, check-outs, leave and fix-scan requests (each can be switched off), optionally for one branch.
 */
@Injectable()
export class TelegramGroupsService {
  constructor(private readonly db: Db, private readonly tg: TelegramService, private readonly audit: AuditService) {}

  /** The bot that joins groups: the admin bot when it is set up, otherwise the staff bot. */
  async groupBot(): Promise<{ bot: BotKind; username: string } | null> {
    const s = await this.db.one(
      `SELECT telegram_bot_username, telegram_setup_at, telegram_admin_bot_username, telegram_admin_setup_at FROM platform_settings WHERE id = 1`,
    );
    if (s.telegram_admin_bot_username && s.telegram_admin_setup_at && (await this.tg.botToken('admin'))) return { bot: 'admin', username: s.telegram_admin_bot_username };
    if (s.telegram_bot_username && s.telegram_setup_at && (await this.tg.botToken('staff'))) return { bot: 'staff', username: s.telegram_bot_username };
    return null;
  }

  async list(user: AuthUser) {
    const companyId = requireCompany(user);
    const [bot, rows] = await Promise.all([
      this.groupBot(),
      this.db.query(
        `SELECT g.*, b.name AS branch_name FROM telegram_groups g LEFT JOIN branches b ON b.id = g.branch_id WHERE g.company_id = $1 ORDER BY g.created_at`,
        [companyId],
      ),
    ]);
    return { available: !!bot, botUsername: bot?.username ?? null, groups: rows.map(mapGroup) };
  }

  async connectLink(user: AuthUser, ip: string) {
    const companyId = requireCompany(user);
    const bot = await this.groupBot();
    if (!bot) throw badRequest('Telegram is not set up on this server yet. Ask MySoft to set up the bot.', 'TELEGRAM_NOT_SET');
    const token = randomToken(18).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    await this.db.query(`DELETE FROM telegram_group_tokens WHERE expires_at < now() OR (company_id = $1 AND user_id = $2)`, [companyId, user.id]);
    await this.db.query(
      `INSERT INTO telegram_group_tokens (token_hash, company_id, user_id, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [sha256(token), companyId, user.id, CODE_MINUTES],
    );
    await this.audit.log({ companyId, userId: user.id, action: 'connect_link', module: 'telegram_groups', ip });
    return { url: `https://t.me/${bot.username}?startgroup=${token}`, botUsername: bot.username, command: `/connect ${token}`, minutes: CODE_MINUTES };
  }

  private async own(user: AuthUser, id: string) {
    const g = await this.db.maybeOne('SELECT * FROM telegram_groups WHERE id = $1 AND company_id = $2', [id, requireCompany(user)]);
    if (!g) throw notFound('Telegram group');
    return g;
  }

  async update(user: AuthUser, id: string, dto: GroupDto, ip: string) {
    const g = await this.own(user, id);
    if (dto.events && !dto.events.length) throw badRequest('Choose at least one kind of message, or remove the group.', 'NO_EVENTS');
    if (dto.branchId) {
      const b = await this.db.maybeOne('SELECT 1 FROM branches WHERE id = $1 AND company_id = $2', [dto.branchId, g.company_id]);
      if (!b) throw badRequest('That branch does not exist.', 'BAD_BRANCH');
    }
    const next = {
      events: dto.events ?? g.events,
      lang: dto.lang ?? g.lang,
      branchId: dto.branchId !== undefined ? dto.branchId : g.branch_id,
      active: dto.active ?? g.active,
    };
    await this.db.query(
      `UPDATE telegram_groups SET events = $2, lang = $3, branch_id = $4, active = $5, status_note = CASE WHEN $5 THEN NULL ELSE status_note END WHERE id = $1`,
      [id, next.events, next.lang, next.branchId, next.active],
    );
    await this.audit.log({ companyId: g.company_id, userId: user.id, action: 'update', module: 'telegram_groups', recordId: id, newValue: next, ip });
    return this.list(user);
  }

  async test(user: AuthUser, id: string) {
    const g = await this.own(user, id);
    const c = await this.db.one('SELECT name FROM companies WHERE id = $1', [g.company_id]);
    const r = await this.tg.sendGroup(g, groupMessages.test(c.name));
    if (!r?.ok) throw badRequest(`Telegram said: ${r?.description ?? 'no answer'}. Is the bot still in the group?`, 'TELEGRAM_FAILED');
    return { ok: true };
  }

  async remove(user: AuthUser, id: string, ip: string) {
    const g = await this.own(user, id);
    await this.tg.call('leaveChat', { chat_id: g.chat_id }, g.bot);
    await this.db.query('DELETE FROM telegram_groups WHERE id = $1', [id]);
    await this.audit.log({ companyId: g.company_id, userId: user.id, action: 'delete', module: 'telegram_groups', recordId: id, oldValue: { title: g.title }, ip });
    return this.list(user);
  }

  /** Webhook: group updates (connect code, bot removed, group upgraded). True when the update was about a group. */
  async handleUpdate(bot: BotKind, update: any): Promise<boolean> {
    const member = update?.my_chat_member;
    if (member?.chat && GROUP_CHATS.includes(member.chat.type)) {
      const status = member.new_chat_member?.status;
      if (status === 'left' || status === 'kicked') {
        await this.db.query(`UPDATE telegram_groups SET active = false, status_note = 'The bot was removed from the group' WHERE chat_id = $1 AND bot = $2`, [member.chat.id, bot]);
      }
      return true;
    }
    const msg = update?.message;
    if (!msg?.chat || !GROUP_CHATS.includes(msg.chat.type)) return false;
    if (msg.migrate_to_chat_id) {
      await this.db.query('UPDATE telegram_groups SET chat_id = $2 WHERE chat_id = $1 AND bot = $3', [msg.chat.id, msg.migrate_to_chat_id, bot]);
      return true;
    }
    const m = /^\/(?:start|connect)(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})\s*$/.exec(typeof msg.text === 'string' ? msg.text.trim() : '');
    if (!m) return true; // other group messages are none of our business
    const t = await this.db.maybeOne('DELETE FROM telegram_group_tokens WHERE token_hash = $1 RETURNING company_id, user_id, expires_at', [sha256(m[1])]);
    const reply = (text: { en: string; km: string }) => this.tg.call('sendMessage', { chat_id: msg.chat.id, text: `${text.km}\n\n${text.en}` }, bot);
    if (!t || new Date(t.expires_at) < new Date()) {
      await reply({
        en: 'This connect code has expired. In MySoft Attendance open Settings → Telegram groups and press "Connect a Telegram group" again.',
        km: 'លេខកូដភ្ជាប់នេះផុតកំណត់ហើយ។ សូមបើក Settings → Telegram groups ក្នុង MySoft Attendance ហើយចុច «Connect a Telegram group» ម្តងទៀត។',
      });
      return true;
    }
    const g = await this.db.one(
      `INSERT INTO telegram_groups (company_id, chat_id, title, bot, linked_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, chat_id) DO UPDATE SET title = EXCLUDED.title, bot = EXCLUDED.bot, active = true, status_note = NULL
       RETURNING *`,
      [t.company_id, msg.chat.id, msg.chat.title ?? null, bot, t.user_id],
    );
    const c = await this.db.one('SELECT name FROM companies WHERE id = $1', [t.company_id]);
    await this.tg.sendGroup({ ...g, lang: 'both' }, groupMessages.connected(c.name, g.events));
    await this.audit.log({ companyId: t.company_id, userId: t.user_id, action: 'connect', module: 'telegram_groups', recordId: g.id, newValue: { title: g.title }, ip: 'telegram' });
    return true;
  }
}

@ApiTags('Telegram')
@ApiBearerAuth()
@Roles('super_admin', 'company_admin', 'hr')
@Controller('telegram-groups')
export class TelegramGroupsController {
  constructor(private readonly groups: TelegramGroupsService) {}

  @Get()
  @ApiOperation({ summary: "The company's Telegram groups (check-ins, check-outs, leave and fix-scan requests are posted there)." })
  list(@CurrentUser() u: AuthUser) {
    return this.groups.list(u);
  }

  @Post('connect-link')
  @HttpCode(200)
  @ApiOperation({ summary: 'A t.me link that adds the bot to a group of your choice and connects it (valid 30 minutes).' })
  connect(@CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.groups.connectLink(u, clientIp(req));
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.groups.update(u, id, dto, clientIp(req));
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.groups.test(u, id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.groups.remove(u, id, clientIp(req));
  }
}
