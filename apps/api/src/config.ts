import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** Repository root (apps/api/dist/config.js -> ../../..). */
const ROOT = path.resolve(__dirname, '..', '..', '..');

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = env(name);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const isProduction = env('NODE_ENV') === 'production';
const storageDir = path.resolve(env('STORAGE_DIR', path.join(ROOT, 'data'))!);

/**
 * The JWT/HMAC secret. Production must set JWT_SECRET; elsewhere a random secret is created once and kept
 * in the storage folder so log-ins survive restarts.
 */
function loadSecret(): string {
  const fromEnv = env('JWT_SECRET');
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return fromEnv;
  }
  if (isProduction) throw new Error('JWT_SECRET is required when NODE_ENV=production');
  const file = path.join(storageDir, 'secret.key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    fs.mkdirSync(storageDir, { recursive: true });
    const s = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

const port = int('PORT', 3200);
const publicUrl = (env('PUBLIC_URL', `http://localhost:${port}`) as string).replace(/\/+$/, '');

export const config = {
  isProduction,
  isTest: env('NODE_ENV') === 'test',
  port,
  /** Base URL printed inside QR codes, e.g. https://attendance.example.com */
  publicUrl,
  databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@127.0.0.1:54330/qr_attendance') as string,
  databasePoolSize: int('DATABASE_POOL_SIZE', 20),
  storageDir,
  uploadsDir: path.join(storageDir, 'uploads'),
  webDist: path.resolve(env('WEB_DIST', path.join(ROOT, 'apps', 'web', 'dist'))!),
  get jwtSecret(): string {
    return (this._secret ??= loadSecret());
  },
  _secret: undefined as string | undefined,
  accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL', 15 * 60),
  refreshTokenDays: int('REFRESH_TOKEN_DAYS', 30),
  cookieSecure: env('COOKIE_SECURE') ? env('COOKIE_SECURE') === 'true' : publicUrl.startsWith('https://'),
  trustProxy: env('TRUST_PROXY', isProduction ? '1' : '0') as string,
  httpsKeyFile: env('HTTPS_KEY_FILE'),
  httpsCertFile: env('HTTPS_CERT_FILE'),
  logFormat: env('LOG_FORMAT', isProduction ? 'json' : 'text') as 'json' | 'text',
  /** Optional first super admin, created by `npm run migrate` when no super admin exists yet. */
  superAdminEmail: env('SUPERADMIN_EMAIL'),
  superAdminPassword: env('SUPERADMIN_PASSWORD'),
  /** Requests per minute per IP for the whole API (log-in and scan have tighter limits). */
  rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 300),
  /**
   * Public demo (DEMO_MODE=true): this server holds only the demo company, which is rebuilt with fresh sample data
   * every night; accounts that visitors share cannot be locked, renamed or have their password changed.
   */
  demoMode: env('DEMO_MODE') === 'true',
  demoCompanyCode: env('DEMO_COMPANY_CODE', 'DemoCompany') as string,
  demoPassword: env('DEMO_PASSWORD', 'democompany123456') as string,
  /** Local hour (Asia/Phnom_Penh) at which the demo data is rebuilt. */
  demoResetHour: int('DEMO_RESET_HOUR', 3),
  /** The real website, for sign-up links shown on the demo. */
  mainSiteUrl: (env('MAIN_SITE_URL', 'https://www.mysoftkh.com') as string).replace(/\/+$/, ''),
};
