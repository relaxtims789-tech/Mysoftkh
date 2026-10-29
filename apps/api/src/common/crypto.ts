import * as crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt$N$r$p$salt$hash — parameters are stored so they can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** A hash to compare against when the user does not exist, so timing does not reveal valid usernames. */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

export function hmac(secret: string, value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Readable temporary password, e.g. "Kp7-mQ4x-Tz9". */
export function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pick = () => alphabet[crypto.randomInt(alphabet.length)];
  const group = () => pick() + pick() + pick() + pick();
  return `${group()}-${group()}-${crypto.randomInt(10, 99)}`;
}

export interface P256Jwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

/** RFC 7638 thumbprint of a P-256 public key; this is the device identifier. */
export function jwkThumbprint(jwk: P256Jwk): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

export function isP256Jwk(v: any): v is P256Jwk {
  return (
    v && typeof v === 'object' && v.kty === 'EC' && v.crv === 'P-256' &&
    typeof v.x === 'string' && typeof v.y === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v.x) && /^[A-Za-z0-9_-]{43}$/.test(v.y)
  );
}

/** Verifies a WebCrypto ECDSA P-256/SHA-256 signature (raw r||s, base64url) over a UTF-8 message. */
export function verifyDeviceSignature(jwk: P256Jwk, message: string, signatureB64: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    const sig = Buffer.from(signatureB64, 'base64url');
    if (sig.length !== 64) return false;
    return crypto.verify('sha256', Buffer.from(message, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch {
    return false;
  }
}

/** Encrypts a stored secret (PayWay API key, bot tokens) with AES-256-GCM under a key derived from `master`. */
export function sealSecret(master: string, plain: string): string {
  const key = crypto.createHash('sha256').update(`qra-settings|${master}`).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** Null when the value cannot be opened (e.g. JWT_SECRET changed): the super admin enters it again. */
export function openSecret(master: string, sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [v, iv, tag, body] = sealed.split('.');
    if (v !== 'v1') return null;
    const key = crypto.createHash('sha256').update(`qra-settings|${master}`).digest();
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
