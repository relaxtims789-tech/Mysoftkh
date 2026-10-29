import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Db } from '../../database/db.service';
import { AuthUser, CurrentUser, requireCompany, Roles } from '../../common/auth';
import { pageParams, Where } from '../../common/sql';

@ApiTags('Audit log')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly db: Db) {}

  @Get()
  @Roles('super_admin', 'company_admin', 'hr')
  @ApiOperation({ summary: 'Who changed what, when, from where (filter by module, action, record, date).' })
  async list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    const w = new Where().add('l.company_id = ?', requireCompany(u));
    if (/^[a-z_]{2,40}$/.test(q.module || '')) w.add('l.module = ?', q.module);
    if (/^[a-z_]{2,40}$/.test(q.action || '')) w.add('l.action = ?', q.action);
    if (q.recordId && q.recordId.length <= 64) w.add('l.record_id = ?', q.recordId);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) w.add('l.created_at >= ?::date', q.from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) w.add(`l.created_at < ?::date + interval '1 day'`, q.to);
    const { limit, offset, page, pageSize } = pageParams({ page: Number(q.page), pageSize: Number(q.pageSize) }, 200);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM audit_logs l ${w}`, w.params)).n;
    const items = await this.db.query(
      `SELECT l.id, l.created_at AS "createdAt", l.action, l.module, l.record_id AS "recordId", l.old_value AS "oldValue", l.new_value AS "newValue",
              l.ip_address AS ip, u.name AS "userName", u.role AS "userRole"
         FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id ${w} ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit} OFFSET ${offset}`,
      w.params,
    );
    return { items, total, page, pageSize };
  }
}
