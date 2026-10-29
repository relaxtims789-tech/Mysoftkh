import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import { Db, Queryable } from '../../database/db.service';
import { badRequest } from '../../common/errors';
import { hmac, randomToken, safeEqual } from '../../common/crypto';

const CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * One-time challenges the phone signs with its device key. Bound to the user, valid for 2 minutes and
 * usable once, so a captured request cannot be replayed.
 */
@Injectable()
export class ChallengeService {
  constructor(private readonly db: Db) {}

  issue(userId: string): { challenge: string; expiresAt: string } {
    const exp = Date.now() + CHALLENGE_TTL_MS;
    const nonce = randomToken(16);
    const sig = hmac(config.jwtSecret, `chal|${userId}|${exp}|${nonce}`);
    return { challenge: `${exp}.${nonce}.${sig}`, expiresAt: new Date(exp).toISOString() };
  }

  /** Checks the signature and expiry, then marks the challenge used. Throws on any problem. */
  async consume(userId: string, challenge: string, tx: Queryable = this.db): Promise<void> {
    const parts = typeof challenge === 'string' ? challenge.split('.') : [];
    const bad = (message: string) => badRequest(message, 'BAD_CHALLENGE');
    if (parts.length !== 3) throw bad('The request is invalid. Please try again.');
    const [expStr, nonce, sig] = parts;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || !/^[A-Za-z0-9_-]{16,40}$/.test(nonce)) throw bad('The request is invalid. Please try again.');
    if (!safeEqual(sig, hmac(config.jwtSecret, `chal|${userId}|${exp}|${nonce}`))) throw bad('The request is invalid. Please try again.');
    if (exp < Date.now()) throw bad('The request took too long. Please scan again.');
    const inserted = await tx.query(
      `INSERT INTO used_nonces (nonce, expires_at) VALUES ($1, $2) ON CONFLICT (nonce) DO NOTHING RETURNING nonce`,
      [nonce, new Date(exp)],
    );
    if (!inserted.length) throw bad('This request was already used. Please scan again.');
    if (Math.random() < 0.05) await tx.query('DELETE FROM used_nonces WHERE expires_at < now()');
  }
}

/** The exact text the phone signs for a scan; the web app builds the same string. */
export function scanMessage(p: { challenge: string; qrToken: string; type?: string | null; latitude?: number | null; longitude?: number | null; accuracy?: number | null }): string {
  const v = (x: unknown) => (x === undefined || x === null ? '' : String(x));
  return ['QRA-SCAN', p.challenge, p.qrToken, v(p.type), v(p.latitude), v(p.longitude), v(p.accuracy)].join('|');
}

export function registerMessage(challenge: string): string {
  return `QRA-REGISTER|${challenge}`;
}
