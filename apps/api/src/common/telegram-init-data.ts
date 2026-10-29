import * as crypto from 'crypto';

/**
 * Telegram Mini App launch data (window.Telegram.WebApp.initData) is signed by Telegram with the bot token:
 *   secret = HMAC_SHA256(key = "WebAppData", message = bot token)
 *   hash   = hex(HMAC_SHA256(key = secret, message = "key=value" lines of every other field, sorted, joined by "\n"))
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: number;
}

export function signInitData(fields: Record<string, string>, botToken: string): string {
  const check = Object.keys(fields).filter((k) => k !== 'hash').sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  return crypto.createHmac('sha256', secret).update(check).digest('hex');
}

/** Null unless the data is signed with this bot's token and not older than `maxAgeSeconds`. */
export function verifyInitData(initData: string, botToken: string, maxAgeSeconds = 86400, now = Date.now()): VerifiedInitData | null {
  if (!initData || !botToken || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const fields: Record<string, string> = {};
  params.forEach((v, k) => {
    if (k !== 'hash') fields[k] = v;
  });
  const expected = signInitData(fields, botToken);
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || authDate * 1000 > now + 60_000 || now - authDate * 1000 > maxAgeSeconds * 1000) return null;
  try {
    const user = JSON.parse(fields.user ?? '') as TelegramWebAppUser;
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) return null;
    return { user, authDate };
  } catch {
    return null;
  }
}
