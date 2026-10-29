import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { config } from '../../config';
import { Db } from '../../database/db.service';
import { AuthUser } from '../../common/auth';
import { badRequest, notFound } from '../../common/errors';
import { randomToken } from '../../common/crypto';
import { AuditService } from '../audit/audit.service';

/** Printed QR tokens: 32 random bytes, base64url (43 chars). Nothing about employees is ever in a QR. */
export const QR_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function qrUrl(token: string): string {
  return `${config.publicUrl}/scan/${token}`;
}

/** Pulls the token out of whatever the camera read: a full scan URL or the bare token. */
export function extractQrToken(raw: string): string | null {
  const s = (raw || '').trim();
  if (QR_TOKEN_RE.test(s)) return s;
  const m = s.match(/\/scan\/([A-Za-z0-9_-]{32,64})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

function mapQr(r: any) {
  return {
    id: r.id,
    branchId: r.branch_id,
    branchName: r.branch_name,
    branchCode: r.branch_code,
    branchStatus: r.branch_status,
    label: r.label,
    token: r.token,
    url: qrUrl(r.token),
    status: r.status,
    createdAt: r.created_at,
    regeneratedAt: r.regenerated_at,
    disabledAt: r.disabled_at,
    scansToday: r.scans_today ?? undefined,
    lastScanAt: r.last_scan_at ?? undefined,
  };
}

@Injectable()
export class QrService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  async list(companyId: string, branchId?: string) {
    const rows = await this.db.query(
      `SELECT q.*, b.name AS branch_name, b.code AS branch_code, b.status AS branch_status,
              (SELECT count(*) FROM attendance a WHERE a.qr_code_id = q.id AND a.scan_time > now() - interval '24 hours')::int AS scans_today,
              (SELECT max(scan_time) FROM attendance a WHERE a.qr_code_id = q.id) AS last_scan_at
         FROM qr_codes q JOIN branches b ON b.id = q.branch_id
        WHERE q.company_id = $1 AND ($2::uuid IS NULL OR q.branch_id = $2)
        ORDER BY q.status, b.name, q.created_at`,
      [companyId, branchId ?? null],
    );
    return rows.map(mapQr);
  }

  async get(companyId: string, id: string) {
    const r = await this.db.maybeOne(
      `SELECT q.*, b.name AS branch_name, b.code AS branch_code, b.status AS branch_status
         FROM qr_codes q JOIN branches b ON b.id = q.branch_id WHERE q.company_id = $1 AND q.id = $2`,
      [companyId, id],
    );
    if (!r) throw notFound('QR code');
    return mapQr(r);
  }

  async create(companyId: string, branchId: string, label: string | undefined, actor: AuthUser, ip: string) {
    const branch = await this.db.maybeOne('SELECT id, status FROM branches WHERE company_id = $1 AND id = $2', [companyId, branchId]);
    if (!branch) throw badRequest('Branch not found.', 'BAD_REFERENCE');
    const r = await this.db.one(
      `INSERT INTO qr_codes (company_id, branch_id, token, label, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [companyId, branchId, randomToken(32), label?.trim() || null, actor.id],
    );
    await this.audit.log({ companyId, userId: actor.id, action: 'create', module: 'qr_codes', recordId: r.id, newValue: { branchId, label }, ip });
    return this.get(companyId, r.id);
  }

  /** New token for the same QR record: every printed copy of the old one stops working immediately. */
  async regenerate(companyId: string, id: string, actor: AuthUser, ip: string) {
    const before = await this.get(companyId, id);
    await this.db.query(
      `UPDATE qr_codes SET token = $3, status = 'active', disabled_at = NULL, regenerated_at = now() WHERE company_id = $1 AND id = $2`,
      [companyId, id, randomToken(32)],
    );
    await this.audit.log({
      companyId, userId: actor.id, action: 'regenerate', module: 'qr_codes', recordId: id,
      oldValue: { tokenEnd: before.token.slice(-6), status: before.status }, newValue: { status: 'active' }, ip,
    });
    return this.get(companyId, id);
  }

  async setStatus(companyId: string, id: string, status: 'active' | 'disabled', actor: AuthUser, ip: string) {
    const before = await this.get(companyId, id);
    await this.db.query(
      `UPDATE qr_codes SET status = $3, disabled_at = CASE WHEN $3 = 'disabled' THEN now() END WHERE company_id = $1 AND id = $2`,
      [companyId, id, status],
    );
    await this.audit.log({ companyId, userId: actor.id, action: status === 'disabled' ? 'disable' : 'enable', module: 'qr_codes', recordId: id, oldValue: { status: before.status }, newValue: { status }, ip });
    return this.get(companyId, id);
  }

  /** Everything the print page needs: SVG, company name/logo and branch. */
  async printData(companyId: string, id: string) {
    const qr = await this.get(companyId, id);
    const company = await this.db.one('SELECT name, logo FROM companies WHERE id = $1', [companyId]);
    const svg = await QRCode.toString(qr.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    return { ...qr, companyName: company.name, companyLogo: company.logo, svg };
  }

  async png(companyId: string, id: string, size = 1024): Promise<{ buffer: Buffer; filename: string }> {
    const qr = await this.get(companyId, id);
    const buffer = await QRCode.toBuffer(qr.url, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: Math.min(Math.max(size, 256), 2048) });
    return { buffer, filename: `qr-${qr.branchCode}-${qr.id.slice(0, 8)}.png` };
  }

  /**
   * Public lookup used when a phone opens a scanned link before sign-in: tells the app which branch it is.
   * Reveals only what is printed on the poster anyway.
   */
  async resolve(token: string) {
    if (!QR_TOKEN_RE.test(token)) return { valid: false, message: 'This is not an attendance QR code.' };
    const r = await this.db.maybeOne(
      `SELECT q.status, b.name AS branch_name, b.status AS branch_status, c.name AS company_name, c.code AS company_code, c.logo, c.status AS company_status
         FROM qr_codes q JOIN branches b ON b.id = q.branch_id JOIN companies c ON c.id = q.company_id WHERE q.token = $1`,
      [token],
    );
    if (!r || r.company_status !== 'active') return { valid: false, message: 'This QR code is not valid.' };
    if (r.status !== 'active' || r.branch_status !== 'active') return { valid: false, message: 'This QR code has been disabled. Use the current QR code at the entrance.' };
    return { valid: true, branchName: r.branch_name, companyName: r.company_name, companyCode: r.company_code, companyLogo: r.logo };
  }
}
