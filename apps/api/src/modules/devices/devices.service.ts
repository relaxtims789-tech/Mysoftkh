import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../../database/db.service';
import { AuthUser, requireEmployee } from '../../common/auth';
import { badRequest, notFound } from '../../common/errors';
import { isP256Jwk, jwkThumbprint, P256Jwk, randomToken, sha256, verifyDeviceSignature } from '../../common/crypto';
import { scopeEmployees, Where } from '../../common/sql';
import { AuditService } from '../audit/audit.service';
import { CompanyContextService } from '../core/company-context.service';
import { TelegramService } from '../core/telegram.service';
import { adminMessages, REVIEW, tgMessages } from '../core/telegram-messages';
import { ChallengeService, registerMessage } from './challenge.service';

export interface RegisterDeviceInput {
  publicKey: unknown;
  deviceName?: string;
  platform?: string;
  challenge: string;
  signature: string;
}

export interface RegisterResult {
  device: ReturnType<typeof mapDevice>;
  message: string;
  /** New device-cookie value for the controller to set (only when it changed). */
  deviceToken?: string;
}

export const DEVICE_MESSAGES: Record<string, string> = {
  active: 'This phone is registered for attendance.',
  pending: 'This phone is waiting for administrator approval. You can scan once it is approved.',
  rejected: 'This phone was rejected by your administrator. Use your registered phone or contact HR.',
  revoked: 'This phone is no longer registered. Contact HR to register it again.',
};

function mapDevice(r: any) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.employee_name,
    department: r.department_name,
    deviceName: r.device_name,
    platform: r.platform,
    status: r.status,
    registeredAt: r.registered_at,
    approvedAt: r.approved_at,
    lastUsedAt: r.last_used_at,
  };
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ctx: CompanyContextService,
    private readonly challenges: ChallengeService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Registers this phone's key for the signed-in employee. The phone proves it holds the private key by signing a
   * fresh challenge. With device binding on, the first phone is approved automatically (or by an admin, per
   * company setting); any further phone waits for approval.
   */
  async register(user: AuthUser, input: RegisterDeviceInput, meta: { ip: string; userAgent: string; deviceToken?: string }): Promise<RegisterResult> {
    const employeeId = requireEmployee(user);
    const companyId = user.companyId!;
    if (!isP256Jwk(input.publicKey)) throw badRequest('This browser could not create a device key.', 'BAD_DEVICE_KEY');
    const jwk = input.publicKey as P256Jwk;
    await this.challenges.consume(user.id, input.challenge);
    if (!verifyDeviceSignature(jwk, registerMessage(input.challenge), input.signature)) throw badRequest('Device verification failed.', 'BAD_DEVICE_SIGNATURE');

    const identifier = jwkThumbprint(jwk);
    const { rules } = await this.ctx.get(companyId);
    const name = (input.deviceName || '').slice(0, 80) || null;
    const platform = (input.platform || '').slice(0, 40) || null;
    const ua = meta.userAgent.slice(0, 300);

    return this.db.tx(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`device:${employeeId}`]);
      const existing = await tx.maybeOne('SELECT * FROM devices WHERE employee_id = $1 AND device_identifier = $2', [employeeId, identifier]);
      if (existing?.status === 'active') {
        const token = await this.ensureToken(existing, meta.deviceToken, tx);
        return { device: mapDevice(existing), message: DEVICE_MESSAGES.active, deviceToken: token };
      }

      // Same browser, new key: the device cookie proves it is the phone that is already registered.
      const known = meta.deviceToken
        ? await tx.maybeOne(`SELECT * FROM devices WHERE employee_id = $1 AND device_token_hash = $2 AND status = 'active'`, [employeeId, sha256(meta.deviceToken)])
        : null;
      if (known) {
        if (existing) await tx.query('DELETE FROM devices WHERE id = $1', [existing.id]);
        const token = randomToken(32);
        const row = await tx.one(
          `UPDATE devices SET device_identifier = $2, public_key = $3, device_token_hash = $4, rekeyed_at = now(), user_agent = $5,
                  device_name = coalesce($6, device_name), platform = coalesce($7, platform) WHERE id = $1 RETURNING *`,
          [known.id, identifier, JSON.stringify(jwk), sha256(token), ua, name, platform],
        );
        await this.audit.log({ companyId, userId: user.id, action: 'rekey', module: 'devices', recordId: row.id, newValue: { deviceName: row.device_name, reason: 'browser lost its key; recognised by device cookie' }, ip: meta.ip }, tx);
        return { device: mapDevice(row), message: DEVICE_MESSAGES.active, deviceToken: token };
      }

      if (existing && (existing.status === 'pending' || existing.status === 'rejected')) {
        return { device: mapDevice(existing), message: await this.statusMessage(existing.status, employeeId, tx) };
      }
      const hasActive = !!(await tx.maybeOne(`SELECT 1 FROM devices WHERE employee_id = $1 AND status = 'active'`, [employeeId]));
      const autoApprove = !rules.requireDeviceBinding || (rules.deviceApprovalMode === 'auto_first' && !hasActive);
      const status = autoApprove ? 'active' : 'pending';
      const token = randomToken(32);
      const row = existing
        ? await tx.one(
            `UPDATE devices SET status = $2, public_key = $3, device_name = coalesce($4, device_name), platform = coalesce($5, platform), user_agent = $6,
                    registered_at = now(), approved_at = CASE WHEN $2 = 'active' THEN now() END, approved_by = NULL, device_token_hash = $7 WHERE id = $1 RETURNING *`,
            [existing.id, status, JSON.stringify(jwk), name, platform, ua, sha256(token)],
          )
        : await tx.one(
            `INSERT INTO devices (company_id, employee_id, device_identifier, public_key, device_name, platform, user_agent, status, approved_at, device_token_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'active' THEN now() END, $9) RETURNING *`,
            [companyId, employeeId, identifier, JSON.stringify(jwk), name, platform, ua, status, sha256(token)],
          );
      await this.audit.log({ companyId, userId: user.id, action: 'register', module: 'devices', recordId: row.id, newValue: { deviceName: name, platform, status }, ip: meta.ip }, tx);
      if (status === 'pending') {
        const emp = await tx.one('SELECT name, employee_code, department_id FROM employees WHERE id = $1', [employeeId]);
        this.telegram.alertAdmins(companyId, 'requests', emp.department_id, adminMessages.newDevice(emp.name, emp.employee_code, name ?? null), [REVIEW]);
      }
      return { device: mapDevice(row), message: await this.statusMessage(status, employeeId, tx), deviceToken: token };
    });
  }

  /** Makes sure an active phone's browser holds a valid device cookie; returns a new token to set when it does not. */
  private async ensureToken(device: any, presented: string | undefined, tx: Queryable = this.db): Promise<string | undefined> {
    if (presented && device.device_token_hash && sha256(presented) === device.device_token_hash) return undefined;
    const token = randomToken(32);
    await tx.query('UPDATE devices SET device_token_hash = $2 WHERE id = $1', [device.id, sha256(token)]);
    return token;
  }

  /** Explains a waiting phone in plain words, naming the phone that is already registered. */
  private async statusMessage(status: string, employeeId: string, tx: Queryable = this.db): Promise<string> {
    if (status !== 'pending') return DEVICE_MESSAGES[status];
    const active = await tx.maybeOne(
      `SELECT device_name, registered_at FROM devices WHERE employee_id = $1 AND status = 'active' ORDER BY registered_at DESC LIMIT 1`,
      [employeeId],
    );
    if (!active) return DEVICE_MESSAGES.pending;
    const when = new Date(active.registered_at).toISOString().slice(0, 10);
    return `Your attendance is registered on another phone or browser (${active.device_name ?? 'phone'}, since ${when}). ` +
      'Use that one, or ask HR to approve this one. On iPhone, Safari, Chrome and the home-screen app each count as a different browser.';
  }

  /** The employee's phones; `current` marks the one making the request. */
  async mine(user: AuthUser, currentIdentifier?: string) {
    const employeeId = requireEmployee(user);
    const rows = await this.db.query('SELECT * FROM devices WHERE employee_id = $1 ORDER BY registered_at DESC', [employeeId]);
    return rows.map((r) => ({ ...mapDevice(r), current: !!currentIdentifier && r.device_identifier === currentIdentifier }));
  }

  /** Device status for one key, used by the app on start-up. */
  async status(user: AuthUser, identifier: string, presentedToken?: string) {
    const employeeId = requireEmployee(user);
    const r = await this.db.maybeOne('SELECT * FROM devices WHERE employee_id = $1 AND device_identifier = $2', [employeeId, identifier]);
    const { rules } = await this.ctx.get(user.companyId!);
    // Phones registered before device cookies existed (or whose cookie expired) get one here.
    const deviceToken = r?.status === 'active' ? await this.ensureToken(r, presentedToken) : undefined;
    return {
      registered: !!r,
      device: r ? mapDevice(r) : null,
      message: r ? await this.statusMessage(r.status, employeeId) : 'This phone is not registered yet.',
      bindingRequired: rules.requireDeviceBinding,
      deviceToken,
    };
  }

  /** For scans: the employee's device with this identifier (any status) plus its public key. */
  async findForScan(employeeId: string, identifier: string, tx: Queryable = this.db) {
    return tx.maybeOne('SELECT id, status, public_key FROM devices WHERE employee_id = $1 AND device_identifier = $2', [employeeId, identifier]);
  }

  async list(companyId: string, user: AuthUser, status?: string) {
    const w = new Where().add('v.company_id = ?', companyId);
    scopeEmployees(w, user);
    if (status && ['active', 'pending', 'revoked', 'rejected'].includes(status)) w.add('v.status = ?', status);
    const rows = await this.db.query(
      `SELECT v.*, e.employee_code, e.name AS employee_name, d.name AS department_name
         FROM devices v JOIN employees e ON e.id = v.employee_id LEFT JOIN departments d ON d.id = e.department_id
         ${w} ORDER BY (v.status = 'pending') DESC, v.registered_at DESC LIMIT 500`,
      w.params,
    );
    return rows.map(mapDevice);
  }

  /** Approving a phone makes it the employee's one active device; any other active phone is revoked. */
  async decide(companyId: string, id: string, decision: 'approve' | 'reject' | 'revoke', actor: AuthUser, ip: string) {
    return this.db.tx(async (tx) => {
      const d = await tx.maybeOne('SELECT * FROM devices WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, id]);
      if (!d) throw notFound('Device');
      const status = decision === 'approve' ? 'active' : decision === 'reject' ? 'rejected' : 'revoked';
      if (decision === 'approve') {
        await tx.query(`UPDATE devices SET status = 'revoked' WHERE employee_id = $1 AND status = 'active' AND id <> $2`, [d.employee_id, id]);
      }
      const r = await tx.one(
        `UPDATE devices SET status = $2, approved_by = CASE WHEN $2 = 'active' THEN $3::uuid ELSE approved_by END,
                approved_at = CASE WHEN $2 = 'active' THEN now() ELSE approved_at END WHERE id = $1 RETURNING *`,
        [id, status, actor.id],
      );
      await this.audit.log({ companyId, userId: actor.id, action: decision, module: 'devices', recordId: id, oldValue: { status: d.status }, newValue: { status }, ip }, tx);
      if (d.status !== status) this.telegram.notifyEmployee(d.employee_id, tgMessages.device(decision, d.device_name));
      return mapDevice(r);
    });
  }
}
