import { Body, Controller, Get, HttpCode, Injectable, Module, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Public, Roles } from '../../common/auth';
import { hmac } from '../../common/crypto';
import { config } from '../../config';
import { Db } from '../../database/db.service';

const TZ = 'Asia/Phnom_Penh';
/** Not people: search engines, link previews, uptime checks, scripts. */
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|whatsapp\/|monitor|curl|wget|python|java\/|go-http|axios|node-fetch/i;
/** A refresh or a quick back-and-forth to the same page within this time counts once. */
const REPEAT_MINUTES = 10;

class VisitDto {
  @ApiProperty({ description: 'Random id the browser keeps in local storage (not personal data)' })
  @Matches(/^[A-Za-z0-9_-]{8,64}$/) visitorId: string;
  @ApiProperty({ example: '/' }) @Matches(/^\/[A-Za-z0-9/_-]{0,99}$/) path: string;
  @ApiPropertyOptional({ description: 'document.referrer of the first page view' }) @IsOptional() @IsString() @MaxLength(500) referrer?: string;
  @ApiPropertyOptional({ enum: ['en', 'km'] }) @IsOptional() @IsIn(['en', 'km']) lang?: string;
}

function deviceOf(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet|Tab(?!le)|Kindle|Silk/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|HarmonyOS/i.test(ua)) return 'mobile';
  return 'desktop';
}

const hostOf = (value: string | undefined) => {
  try {
    // m.facebook.com, l.facebook.com, lm.facebook.com and www.facebook.com are all "facebook.com"
    return value ? new URL(value).host.toLowerCase().replace(/^(www|m|l|lm|mobile|mbasic)\./, '') : null;
  } catch {
    return null;
  }
};

@Injectable()
export class VisitorsService {
  constructor(private readonly db: Db) {}

  /** One page view on the public website. Bots and repeats within a few minutes are not counted. */
  async record(dto: VisitDto, ua: string, hostHeader: string) {
    if (!ua || BOT.test(ua)) return { counted: false };
    const visitor = hmac(config.jwtSecret, `visitor:${dto.visitorId}`).slice(0, 32);
    const host = (hostHeader || '').toLowerCase().replace(/:\d+$/, '');
    // Only links from other sites count as a referrer, not moving around our own pages.
    const ownHosts = new Set([host.replace(/^www\./, ''), hostOf(config.publicUrl)]);
    const ref = hostOf(dto.referrer);
    const referrer = ref && !ownHosts.has(ref) ? ref : null;
    const r = await this.db.maybeOne(
      `INSERT INTO site_visits (day, visitor, path, referrer, lang, device, host)
       SELECT (now() AT TIME ZONE $1)::date, $2, $3, $4, $5, $6, $7
        WHERE NOT EXISTS (SELECT 1 FROM site_visits WHERE visitor = $2 AND path = $3 AND visited_at > now() - make_interval(mins => $8))
       RETURNING id`,
      [TZ, visitor, dto.path, referrer, dto.lang ?? null, deviceOf(ua), host || null, REPEAT_MINUTES],
    );
    return { counted: !!r };
  }

  /** Super admin: visitors and page views, now / today / 7 / 30 days / all time, per day, and where they come from. */
  async stats(days: number) {
    const totals = await this.db.one(
      `WITH t AS (SELECT (now() AT TIME ZONE $1)::date AS today)
       SELECT
         (SELECT count(DISTINCT visitor) FROM site_visits WHERE visited_at > now() - interval '5 minutes')::int AS online,
         count(*) FILTER (WHERE day = t.today)::int AS today_views,
         count(DISTINCT visitor) FILTER (WHERE day = t.today)::int AS today_visitors,
         count(*) FILTER (WHERE day = t.today - 1)::int AS yesterday_views,
         count(DISTINCT visitor) FILTER (WHERE day = t.today - 1)::int AS yesterday_visitors,
         count(*) FILTER (WHERE day > t.today - 7)::int AS week_views,
         count(DISTINCT visitor) FILTER (WHERE day > t.today - 7)::int AS week_visitors,
         count(*) FILTER (WHERE day > t.today - 30)::int AS month_views,
         count(DISTINCT visitor) FILTER (WHERE day > t.today - 30)::int AS month_visitors,
         count(*)::int AS all_views,
         count(DISTINCT visitor)::int AS all_visitors,
         min(day) AS since
       FROM t LEFT JOIN site_visits ON true
       GROUP BY t.today`,
      [TZ],
    );
    const range = await this.db.one(`SELECT (now() AT TIME ZONE $1)::date - $2::int + 1 AS "from", (now() AT TIME ZONE $1)::date AS "to"`, [TZ, days]);
    const daily = await this.db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date, coalesce(v.views, 0)::int AS views, coalesce(v.visitors, 0)::int AS visitors, coalesce(s.signups, 0)::int AS signups
         FROM generate_series($1::date, $2::date, interval '1 day') d
         LEFT JOIN (SELECT day, count(*) AS views, count(DISTINCT visitor) AS visitors FROM site_visits WHERE day BETWEEN $1 AND $2 GROUP BY day) v ON v.day = d::date
         LEFT JOIN (SELECT (created_at AT TIME ZONE $3)::date AS day, count(*) AS signups FROM companies WHERE signup_source = 'website' GROUP BY 1) s ON s.day = d::date
        ORDER BY d`,
      [range.from, range.to, TZ],
    );
    const top = (column: string, limit = 8) =>
      this.db.query(
        `SELECT coalesce(${column}, '') AS name, count(*)::int AS views, count(DISTINCT visitor)::int AS visitors
           FROM site_visits WHERE day BETWEEN $1 AND $2 GROUP BY 1 ORDER BY visitors DESC, views DESC LIMIT ${limit}`,
        [range.from, range.to],
      );
    const [pages, referrers, devices, languages, signups] = await Promise.all([
      top('path'),
      top('referrer'),
      top('device', 3),
      top('lang', 3),
      this.db.one(`SELECT count(*)::int AS n FROM companies WHERE signup_source = 'website' AND (created_at AT TIME ZONE $3)::date BETWEEN $1 AND $2`, [range.from, range.to, TZ]),
    ]);
    return {
      days,
      from: range.from as string, // dates come back as 'YYYY-MM-DD' strings (db.service type parser)
      online: totals.online,
      today: { views: totals.today_views, visitors: totals.today_visitors },
      yesterday: { views: totals.yesterday_views, visitors: totals.yesterday_visitors },
      week: { views: totals.week_views, visitors: totals.week_visitors },
      month: { views: totals.month_views, visitors: totals.month_visitors },
      allTime: { views: totals.all_views, visitors: totals.all_visitors, since: totals.since },
      signups: signups.n,
      daily,
      pages,
      referrers,
      devices,
      languages,
    };
  }
}

@ApiTags('Public')
@Controller('public/visit')
export class VisitController {
  constructor(private readonly visitors: VisitorsService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Counts a page view on the public website (anonymous; bots are ignored).' })
  visit(@Body() dto: VisitDto, @Req() req: Request) {
    return this.visitors.record(dto, String(req.headers['user-agent'] ?? ''), String(req.headers.host ?? ''));
  }
}

@ApiTags('Platform (super admin)')
@Roles('super_admin')
@Controller('platform/visitors')
export class VisitorStatsController {
  constructor(private readonly visitors: VisitorsService) {}

  @Get()
  @ApiOperation({ summary: 'Website visitors: online now, today, 7/30 days, per day, pages, referrers, devices (super admin only).' })
  stats(@Query('days') days?: string) {
    const n = Number(days);
    return this.visitors.stats([7, 30, 90].includes(n) ? n : 30);
  }
}

@Module({ controllers: [VisitController, VisitorStatsController], providers: [VisitorsService] })
export class VisitorsModule {}
