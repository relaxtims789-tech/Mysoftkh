import { Injectable, Logger } from '@nestjs/common';
import { Db, Queryable } from '../../database/db.service';

export interface AuditEntry {
  companyId: string | null;
  userId: string | null;
  action: string;
  module: string;
  recordId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
}

const SECRET_KEYS = /password|token|secret|hash|key_hash|public_key/i;

/** Drops secrets before anything is written to the audit log. */
function clean(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(clean);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (!SECRET_KEYS.test(k)) out[k] = clean(val);
    }
    return out;
  }
  return v;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly db: Db) {}

  /** Writes an audit row. Pass the transaction so the log commits (or rolls back) with the change itself. */
  async log(e: AuditEntry, tx: Queryable = this.db): Promise<void> {
    await tx.query(
      `INSERT INTO audit_logs (company_id, user_id, action, module, record_id, old_value, new_value, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [e.companyId, e.userId, e.action, e.module, e.recordId ?? null, JSON.stringify(clean(e.oldValue)), JSON.stringify(clean(e.newValue)), e.ip ?? null],
    );
    this.logger.log(`${e.module}.${e.action} ${e.recordId ?? ''} by ${e.userId ?? 'system'}`);
  }
}

/** Only the fields that changed, for old/new audit values. */
export function diff(before: Record<string, any>, after: Record<string, any>): { old: Record<string, any>; new: Record<string, any> } {
  const o: Record<string, any> = {};
  const n: Record<string, any> = {};
  for (const k of Object.keys(after)) {
    const a = before?.[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      o[k] = a;
      n[k] = b;
    }
  }
  return { old: o, new: n };
}
