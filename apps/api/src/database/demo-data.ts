/**
 * Public demo database (DEMO_MODE=true). The demo server has its own database holding only "DemoCompany" with about
 * 6 months of sample data. It is rebuilt from scratch every night (config.demoResetHour, Phnom Penh time), so changes
 * visitors make never pile up. Runs before the Nest app starts; the payroll history is added afterwards by DemoService.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client, Pool } from 'pg';
import { config } from '../config';
import { addDays, localParts } from '../domain/time';
import { runMigrations } from './migrate';
import { seedDemo } from './seed';

export const DEMO_TZ = 'Asia/Phnom_Penh';
export const DEMO_EMAIL_DOMAIN = 'demo.mysoftkh.com';
export const DEMO_COMPANY_NAME = 'Demo Company Co., Ltd.';
/** Employee that visitors use in the staff app. */
export const DEMO_EMPLOYEE_ID = 'E0001';
/** History starts on the 1st of the month this many months back, so payroll has 6 full months. */
export const DEMO_MONTHS = 6;

/** The demo "day" starts at the reset hour, so data made at 03:10 is fresh until 03:00 the next day. */
export function demoDay(at: Date): string {
  return localParts(new Date(at.getTime() - config.demoResetHour * 3600_000), DEMO_TZ).date;
}

/** First day of the demo history: the 1st of the month DEMO_MONTHS months before this one. */
export function demoStart(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - DEMO_MONTHS, 1));
  return d.toISOString().slice(0, 10);
}

/** Creates the demo database when the Postgres server does not have it yet (the demo shares the main Postgres). */
async function ensureDatabase(log: (m: string) => void) {
  const probe = new Client({ connectionString: config.databaseUrl });
  try {
    await probe.connect();
    await probe.end();
    return;
  } catch (e: any) {
    await probe.end().catch(() => undefined);
    if (e?.code !== '3D000') throw e; // only "database does not exist" is handled here
  }
  const url = new URL(config.databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected demo database name "${name}"`);
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    log(`created database ${name}`);
  } finally {
    await admin.end();
  }
}

/** When the demo data was made (the demo company's creation time), or null when there is none. */
async function seededAt(pool: Pool): Promise<Date | null> {
  try {
    const r = await pool.query('SELECT created_at FROM companies WHERE lower(code) = lower($1)', [config.demoCompanyCode]);
    return r.rows[0]?.created_at ?? null;
  } catch {
    return null; // no tables yet
  }
}

export async function isDemoStale(pool: Pool, now = new Date()): Promise<boolean> {
  const at = await seededAt(pool);
  return !at || demoDay(at) !== demoDay(now);
}

/** Makes sure the demo database exists and holds today's demo data; rebuilds it when it is from an earlier day. */
export async function prepareDemoData(log: (m: string) => void = console.log): Promise<boolean> {
  await ensureDatabase(log);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  try {
    if (!(await isDemoStale(pool))) {
      await runMigrations(pool, log);
      return false;
    }
    log('building fresh demo data (about a minute)');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    // Files visitors uploaded (logos, photos, receipts) go too.
    for (const dir of [config.uploadsDir, path.join(config.storageDir, 'receipts')]) fs.rmSync(dir, { recursive: true, force: true });
    await runMigrations(pool, log);
    const today = localParts(new Date(), DEMO_TZ).date;
    let days = 0;
    while (addDays(today, -days) > demoStart(today)) days++;
    const seeded = await seedDemo(pool, {
      employees: 120,
      days,
      log,
      company: { name: DEMO_COMPANY_NAME, code: config.demoCompanyCode, emailDomain: DEMO_EMAIL_DOMAIN, branchNames: ['Head Office Phnom Penh', 'Siem Reap Branch', 'Sihanoukville Branch'] },
      password: config.demoPassword,
      adminUsername: config.demoCompanyCode,
      superAdmin: false,
      // Visitors try the staff app from anywhere: no geofence, no phone approval, check-in button on.
      rules: { requireGps: false, requireDeviceBinding: false, allowButtonCheckin: true },
    });
    if (seeded) await pool.query('UPDATE companies SET billing_exempt = true WHERE id = $1', [seeded.companyId]);
    return true;
  } finally {
    await pool.end();
  }
}
