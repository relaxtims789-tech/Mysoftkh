/**
 * Demo data: one company (code "camdemo") with 3 branches, QR codes, departments, schedules, Cambodian public holidays,
 * employees with registered phones, ~30 days of attendance, leave, corrections and a few rejected scans.
 * The public demo (DEMO_MODE, modules/demo) uses the same generator for "DemoCompany" with about 6 months of history.
 *
 *   node dist/database/seed.js [--reset] [--employees 120] [--days 30]
 *
 * --reset wipes the whole database first (refused when NODE_ENV=production).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { hashPassword, jwkThumbprint, randomToken } from '../common/crypto';
import { normalizePhone } from '../common/phone';
import { evaluatePunch, Schedule } from '../domain/punch-rules';
import { addDays, isoWeekday, localParts, zonedToUtc } from '../domain/time';
import { runMigrations } from './migrate';

export const DEMO_PASSWORD = 'Demo@1234';
const TZ = 'Asia/Phnom_Penh';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) || fallback : fallback;
}

// Deterministic randomness so every demo looks the same.
let seed = 20261006;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);

const FIRST = ['Dara', 'Sokha', 'Sophea', 'Vanna', 'Bopha', 'Rithy', 'Chenda', 'Kosal', 'Sreymom', 'Visal', 'Piseth', 'Channary', 'Mony', 'Ratana', 'Sopheak', 'Kunthea', 'Vibol', 'Sreyleak', 'Phalla', 'Nimol', 'Borey', 'Lina', 'Makara', 'Theary', 'Samnang', 'Kanha', 'Rachana', 'Sovann', 'Davy', 'Pheakdey'];
const LAST = ['Sok', 'Chan', 'Kim', 'Lim', 'Heng', 'Chea', 'Seng', 'Ly', 'Meas', 'Keo', 'Nhem', 'Ouk', 'Prak', 'Rath', 'Sam', 'Tep', 'Vong', 'Yim', 'Hun', 'Pich'];

const BRANCHES = [
  { name: 'CAM Phnom Penh', code: 'PP', address: 'Preah Norodom Blvd, Phnom Penh', lat: 11.5564, lng: 104.9282, radius: 100, share: 0.6 },
  { name: 'Siem Reap Branch', code: 'SR', address: 'Sivatha Blvd, Siem Reap', lat: 13.3633, lng: 103.8564, radius: 150, share: 0.25 },
  { name: 'Sihanoukville Branch', code: 'SHV', address: 'Ekareach St, Sihanoukville', lat: 10.6253, lng: 103.5234, radius: 100, share: 0.15 },
];
const DEPARTMENTS = ['Sales', 'Customer Service', 'Finance', 'Human Resources', 'IT', 'Operations', 'Warehouse', 'Management'];
const POSITIONS = ['Manager', 'Supervisor', 'Officer', 'Assistant', 'Technician', 'Driver', 'Accountant', 'Sales Executive'];
const HOLIDAYS: [string, string][] = [
  ['01-01', "International New Year's Day"], ['01-07', 'Victory over Genocide Day'], ['03-08', "International Women's Day"],
  ['04-14', 'Khmer New Year'], ['04-15', 'Khmer New Year'], ['04-16', 'Khmer New Year'], ['05-01', 'International Labour Day'],
  ['05-14', "King's Birthday"], ['06-18', "Queen Mother's Birthday"], ['09-24', 'Constitution Day'],
  ['10-15', 'Commemoration Day of King Father'], ['10-29', "King's Coronation Day"], ['11-09', 'Independence Day'],
];

/** A point `meters` away from (lat, lng) in a random direction. */
function jitter(lat: number, lng: number, meters: number) {
  const angle = rnd() * 2 * Math.PI;
  const d = rnd() * meters;
  return {
    lat: lat + (d * Math.cos(angle)) / 111320,
    lng: lng + (d * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

function fakeDeviceKey() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as any;
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } as const;
}

async function insertMany(c: PoolClient, table: string, cols: string[], rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(', ')})`).join(', ');
    await c.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values}`, params);
  }
}

export interface SeedOptions {
  employees?: number;
  /** Days of attendance history (up to 200). */
  days?: number;
  log?: (m: string) => void;
  company?: { name: string; code: string; emailDomain: string; branchNames?: string[] };
  /** Password of every seeded account. */
  password?: string;
  /** Sign-in name of the company admin (default: its email). */
  adminUsername?: string;
  /** Also create the platform super admin (local demo only; never on the public demo). */
  superAdmin?: boolean;
  /** Attendance rules that differ from the defaults. */
  rules?: { requireGps?: boolean; requireDeviceBinding?: boolean; allowButtonCheckin?: boolean };
}

export async function seedDemo(pool: Pool, opts: SeedOptions = {}) {
  const log = opts.log ?? console.log;
  const employeeCount = Math.max(10, Math.min(opts.employees ?? 120, 3000));
  const historyDays = Math.max(1, Math.min(opts.days ?? 30, 200));
  const co = opts.company ?? { name: 'CAM Demo Co., Ltd.', code: 'camdemo', emailDomain: 'camdemo.com' };
  const hash = await hashPassword(opts.password ?? DEMO_PASSWORD);
  const c = await pool.connect();
  try {
    if ((await c.query(`SELECT 1 FROM companies WHERE lower(code) = lower($1)`, [co.code])).rowCount) {
      log('Demo company already exists (use --reset to start over).');
      return null;
    }
    await c.query('BEGIN');

    if (opts.superAdmin !== false) {
      await c.query(
        `INSERT INTO users (company_id, username, email, name, role, password_hash) VALUES (NULL, 'super@qr-attendance.local', 'super@qr-attendance.local', 'Platform Owner', 'super_admin', $1)
         ON CONFLICT DO NOTHING`,
        [hash],
      );
    }
    const company = (await c.query(`INSERT INTO companies (name, code, timezone) VALUES ($1, $2, $3) RETURNING id`, [co.name, co.code, TZ])).rows[0].id;
    const rules0 = opts.rules ?? {};
    await c.query(
      `INSERT INTO attendance_rules (company_id, allow_lunch_scan, require_gps, require_device_binding, allow_button_checkin) VALUES ($1, false, $2, $3, $4)`,
      [company, rules0.requireGps ?? true, rules0.requireDeviceBinding ?? true, rules0.allowButtonCheckin ?? false],
    );

    const office: Schedule = { startTime: '08:00', endTime: '17:00', lunchStart: '12:00', lunchEnd: '13:00', lateAfterMinutes: 15, graceMinutes: 5, workDays: [1, 2, 3, 4, 5] };
    const warehouse: Schedule = { startTime: '07:00', endTime: '16:00', lunchStart: '11:30', lunchEnd: '12:30', lateAfterMinutes: 10, graceMinutes: 5, workDays: [1, 2, 3, 4, 5, 6] };
    const officeId = (await c.query(
      `INSERT INTO work_schedules (company_id, name, start_time, end_time, lunch_start, lunch_end, late_after_minutes, grace_minutes, work_days, is_default)
       VALUES ($1, 'Office hours', '08:00', '17:00', '12:00', '13:00', 15, 5, '{1,2,3,4,5}', true) RETURNING id`, [company])).rows[0].id;
    const warehouseId = (await c.query(
      `INSERT INTO work_schedules (company_id, name, start_time, end_time, lunch_start, lunch_end, late_after_minutes, grace_minutes, work_days)
       VALUES ($1, 'Warehouse shift', '07:00', '16:00', '11:30', '12:30', 10, 5, '{1,2,3,4,5,6}') RETURNING id`, [company])).rows[0].id;

    const branches: { id: string; lat: number; lng: number; radius: number; share: number; qr: string }[] = [];
    for (const [bi, b] of BRANCHES.entries()) {
      const id = (await c.query(
        `INSERT INTO branches (company_id, name, code, address, latitude, longitude, radius) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [company, co.branchNames?.[bi] ?? b.name, b.code, b.address, b.lat, b.lng, b.radius])).rows[0].id;
      const qr = (await c.query(`INSERT INTO qr_codes (company_id, branch_id, token, label) VALUES ($1, $2, $3, 'Main entrance') RETURNING id`, [company, id, randomToken(32)])).rows[0].id;
      branches.push({ id, lat: b.lat, lng: b.lng, radius: b.radius, share: b.share, qr });
    }
    await c.query(`INSERT INTO qr_codes (company_id, branch_id, token, label, status, disabled_at) VALUES ($1, $2, $3, 'Old poster (replaced)', 'disabled', now() - interval '20 days')`, [company, branches[0].id, randomToken(32)]);

    const deptIds: Record<string, string> = {};
    for (const d of DEPARTMENTS) deptIds[d] = (await c.query(`INSERT INTO departments (company_id, name) VALUES ($1, $2) RETURNING id`, [company, d])).rows[0].id;
    const posIds: string[] = [];
    for (const p of POSITIONS) posIds.push((await c.query(`INSERT INTO positions (company_id, name) VALUES ($1, $2) RETURNING id`, [company, p])).rows[0].id);

    const year = Number(localParts(new Date(), TZ).date.slice(0, 4));
    for (const y of [year - 1, year, year + 1]) {
      await insertMany(c, 'holidays', ['company_id', 'name', 'date'], HOLIDAYS.map(([md, name]) => [company, name, `${y}-${md}`]));
    }
    const holidaySet = new Set(HOLIDAYS.flatMap(([md]) => [year - 1, year, year + 1].map((y) => `${y}-${md}`)));

    // Employees: E0001 is Dara Sok in Sales at Phnom Penh (the spec's example employee).
    type Emp = { id: string; code: string; branch: (typeof branches)[number]; schedule: Schedule; scheduleId: string; device: string | null; punctual: number; dept: string };
    const emps: Emp[] = [];
    const today = localParts(new Date(), TZ).date;
    for (let i = 1; i <= employeeCount; i++) {
      const code = `E${String(i).padStart(4, '0')}`;
      const name = i === 1 ? 'Dara Sok' : `${pick(FIRST)} ${pick(LAST)}`;
      const dept = i === 1 ? 'Sales' : DEPARTMENTS[Math.floor(rnd() * DEPARTMENTS.length)];
      const r = rnd();
      const branch = i === 1 ? branches[0] : r < branches[0].share ? branches[0] : r < branches[0].share + branches[1].share ? branches[1] : branches[2];
      const isWarehouse = dept === 'Warehouse';
      const phone = i === 1 ? '012 345 678' : `+855 ${10 + Math.floor(rnd() * 89)} ${String(Math.floor(rnd() * 999999)).padStart(6, '0')}`;
      const id = (await c.query(
        `INSERT INTO employees (company_id, employee_code, name, phone, email, department_id, position_id, branch_id, schedule_id, hired_on, monthly_salary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [company, code, name, phone,
          `${name.toLowerCase().replace(/[^a-z]+/g, '.')}${i}@${co.emailDomain}`, deptIds[dept], pick(posIds), branch.id,
          isWarehouse ? warehouseId : null, addDays(today, -400 - Math.floor(rnd() * 900)), 250 + Math.round(rnd() * 55) * 10])).rows[0].id;
      // Payroll details: most are paid by bank transfer; everyone gets a transport allowance, warehouse staff a tax-free meal allowance.
      const bank = rnd() < 0.85 ? pick(['ABA Bank', 'ABA Bank', 'ACLEDA Bank', 'Wing Bank']) : null;
      await c.query(`UPDATE employees SET dependents = $2, bank_name = $3, bank_account = $4, bank_account_name = $5 WHERE id = $1`,
        [id, Math.floor(rnd() * 3), bank, bank ? `${String(Math.floor(rnd() * 1e9)).padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1 ')}` : null, bank ? name.toUpperCase() : null]);
      await c.query(`INSERT INTO employee_allowances (company_id, employee_id, name, amount, tax_treatment) VALUES ($1, $2, 'Transport', 20, 'salary')`, [company, id]);
      if (isWarehouse) await c.query(`INSERT INTO employee_allowances (company_id, employee_id, name, amount, tax_treatment) VALUES ($1, $2, 'Meal', 15, 'exempt')`, [company, id]);
      await c.query(
        `INSERT INTO users (company_id, employee_id, username, name, role, password_hash, phone, phone_norm) VALUES ($1, $2, $3, $4, 'employee', $5, $6, $7)`,
        [company, id, code, name, hash, phone, normalizePhone(phone)],
      );
      let device: string | null = null;
      if (i !== 1) {
        const jwk = fakeDeviceKey();
        device = (await c.query(
          `INSERT INTO devices (company_id, employee_id, device_identifier, public_key, device_name, platform, status, approved_at, last_used_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', now() - interval '60 days', now() - interval '1 day') RETURNING id`,
          [company, id, jwkThumbprint(jwk), JSON.stringify(jwk), pick(['iPhone 13', 'iPhone 15', 'Galaxy A54', 'Redmi Note 12', 'OPPO A78', 'Vivo Y36']), pick(['iOS', 'Android', 'Android'])])).rows[0].id;
      }
      emps.push({ id, code, branch, schedule: isWarehouse ? warehouse : office, scheduleId: isWarehouse ? warehouseId : officeId, device, punctual: 0.8 + rnd() * 0.18, dept });
    }

    // A second phone waiting for approval (employee E0007).
    const pendingKey = fakeDeviceKey();
    await c.query(
      `INSERT INTO devices (company_id, employee_id, device_identifier, public_key, device_name, platform, status) VALUES ($1, $2, $3, $4, 'Galaxy S24', 'Android', 'pending')`,
      [company, emps[6].id, jwkThumbprint(pendingKey), JSON.stringify(pendingKey)],
    );

    // Staff accounts.
    const staff = [
      [`admin@${co.emailDomain}`, 'Sokha Chan', 'company_admin', null],
      [`hr@${co.emailDomain}`, 'Srey Mom Keo', 'hr', null],
      [`manager@${co.emailDomain}`, 'Visal Heng', 'manager', '011 222 333'],
    ];
    const staffIds: Record<string, string> = {};
    for (const [email, name, role, phone] of staff) {
      const username = role === 'company_admin' && opts.adminUsername ? opts.adminUsername : email;
      staffIds[role!] = (await c.query(
        `INSERT INTO users (company_id, username, email, name, role, password_hash, phone, phone_norm) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [company, username, email, name, role, hash, phone, normalizePhone(phone)])).rows[0].id;
    }
    await c.query(`INSERT INTO manager_departments (user_id, department_id) VALUES ($1, $2), ($1, $3)`, [staffIds.manager, deptIds['Sales'], deptIds['Customer Service']]);

    // Leave: some approved in the past, a couple pending.
    const leaveDays = new Set<string>();
    const leaveRows: unknown[][] = [];
    for (const e of emps) {
      for (let block = 0; block < Math.max(1, Math.round(historyDays / 30)); block++) {
        if (rnd() >= 0.18) continue;
        const start = addDays(today, -Math.floor(between(2, historyDays)));
        const len = rnd() < 0.7 ? 1 : 2;
        const end = addDays(start, len - 1);
        let overlaps = false;
        for (let d = start; d <= end; d = addDays(d, 1)) if (leaveDays.has(`${e.id}|${d}`)) overlaps = true;
        if (overlaps) continue;
        for (let d = start; d <= end; d = addDays(d, 1)) leaveDays.add(`${e.id}|${d}`);
        leaveRows.push([company, e.id, pick(['annual', 'sick', 'sick', 'personal']), start, end, len, block === 0 ? 'Family matter' : pick(['Family matter', 'Not feeling well', 'Wedding in the province', 'Medical check-up']), 'approved', staffIds.hr]);
      }
    }
    leaveRows.push([company, emps[2].id, 'annual', addDays(today, 5), addDays(today, 6), 2, 'Trip to Kampot', 'pending', null]);
    leaveRows.push([company, emps[0].id, 'sick', addDays(today, 2), addDays(today, 2), 1, 'Doctor appointment', 'pending', null]);
    await insertMany(c, 'leave_requests', ['company_id', 'employee_id', 'leave_type', 'start_date', 'end_date', 'days', 'reason', 'status', 'approved_by'], leaveRows);

    // Attendance history.
    const now = new Date();
    const nowLocal = localParts(now, TZ);
    const rows: unknown[][] = [];
    const rules = { allowLunchScan: false, allowOvertime: true, overtimeMinMinutes: 30 };
    const push = (e: Emp, date: string, type: 'check_in' | 'check_out', minutes: number) => {
      const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
      const mm = String(Math.floor(minutes % 60)).padStart(2, '0');
      const t = new Date(zonedToUtc(date, `${hh}:${mm}`, TZ).getTime() + Math.floor(rnd() * 59) * 1000);
      if (t > now) return;
      const working = e.schedule.workDays.includes(isoWeekday(date)) && !holidaySet.has(date);
      const ev = evaluatePunch(type, minutes, e.schedule, rules, working);
      const p = jitter(e.branch.lat, e.branch.lng, e.branch.radius * 0.6);
      const dist = Math.round(Math.hypot((p.lat - e.branch.lat) * 111320, (p.lng - e.branch.lng) * 111320 * Math.cos((e.branch.lat * Math.PI) / 180)) * 10) / 10;
      rows.push([company, e.id, e.branch.id, e.branch.qr, type, t, date, p.lat, p.lng, Math.round(between(5, 35)), dist, e.device, 'qr', ev.status, ev.lateMinutes, ev.earlyMinutes, ev.overtimeMinutes]);
    };
    for (let back = historyDays; back >= 0; back--) {
      const date = addDays(today, -back);
      for (const e of emps) {
        if (e.code === 'E0001' && back === 0) continue; // Dara scans today in the demo
        const working = e.schedule.workDays.includes(isoWeekday(date)) && !holidaySet.has(date);
        if (!working || leaveDays.has(`${e.id}|${date}`)) continue;
        if (rnd() < 0.03) continue; // absent
        const start = Number(e.schedule.startTime.slice(0, 2)) * 60;
        const end = Number(e.schedule.endTime.slice(0, 2)) * 60;
        const late = rnd() > e.punctual;
        const inMin = late ? start + between(e.schedule.lateAfterMinutes + 1, 70) : start - between(-e.schedule.lateAfterMinutes + 2, 30);
        push(e, date, 'check_in', inMin);
        if (back === 0 && nowLocal.minutes < end) continue;
        if (rnd() < 0.02) continue; // forgot to check out
        const r = rnd();
        const outMin = r < 0.04 ? end - between(20, 90) : r < 0.25 ? end + between(35, 150) : end + between(-4, 25);
        push(e, date, 'check_out', outMin);
      }
    }
    await insertMany(c, 'attendance',
      ['company_id', 'employee_id', 'branch_id', 'qr_code_id', 'attendance_type', 'scan_time', 'work_date', 'latitude', 'longitude', 'gps_accuracy', 'distance_from_branch', 'device_id', 'source', 'status', 'late_minutes', 'early_minutes', 'overtime_minutes'],
      rows);

    // Spec example: Dara forgot to scan on a recent day -> pending correction.
    const corrDate = addDays(today, -1);
    await c.query(`DELETE FROM attendance WHERE employee_id = $1 AND work_date = $2 AND attendance_type = 'check_in'`, [emps[0].id, corrDate]);
    await c.query(
      `INSERT INTO attendance_corrections (company_id, employee_id, work_date, attendance_type, requested_time, reason, requested_by)
       VALUES ($1, $2, $3, 'check_in', $4, 'Forgot to scan', (SELECT id FROM users WHERE employee_id = $2))`,
      [company, emps[0].id, corrDate, zonedToUtc(corrDate, '08:03', TZ)],
    );

    // Older correction requests that were already reviewed (longer histories only).
    if (historyDays > 45) {
      const reviewed: unknown[][] = [];
      for (let i = 0; i < Math.round(historyDays / 10); i++) {
        const e = pick(emps);
        const d = addDays(today, -Math.floor(between(10, historyDays)));
        const ok = rnd() < 0.8;
        reviewed.push([company, e.id, d, 'check_in', zonedToUtc(d, '07:58', TZ), pick(['Forgot to scan', 'Phone battery was empty', 'Visited a customer first']),
          ok ? 'approved' : 'rejected', staffIds.hr, zonedToUtc(addDays(d, 1), '09:30', TZ), ok ? null : 'No proof of arrival time', zonedToUtc(d, '18:00', TZ)]);
      }
      await insertMany(c, 'attendance_corrections', ['company_id', 'employee_id', 'work_date', 'attendance_type', 'requested_time', 'reason', 'status', 'reviewed_by', 'reviewed_at', 'review_note', 'created_at'], reviewed);
    }

    // Rejected scans for the security log.
    const attempts: unknown[][] = [];
    for (let i = 0; i < Math.max(14, Math.round(historyDays / 2)); i++) {
      const e = pick(emps);
      const kind = pick(['OUTSIDE_GEOFENCE', 'OUTSIDE_GEOFENCE', 'OUTSIDE_GEOFENCE', 'DEVICE_NOT_REGISTERED', 'GPS_INACCURATE', 'INVALID_QR']);
      const p = jitter(e.branch.lat, e.branch.lng, 3000);
      const msg = {
        OUTSIDE_GEOFENCE: 'Your location is outside the allowed attendance area.',
        DEVICE_NOT_REGISTERED: 'This phone is not registered for attendance.',
        GPS_INACCURATE: 'Your GPS signal is too weak (±420 m).',
        INVALID_QR: 'This QR code is not valid for your company.',
      }[kind]!;
      const at = new Date(now.getTime() - Math.floor(between(0.5, historyDays * 24)) * 3600000);
      attempts.push([company, e.id, e.branch.id, kind === 'INVALID_QR' ? null : e.branch.qr, 'check_in', kind, msg, p.lat, p.lng, kind === 'GPS_INACCURATE' ? 420 : 18, kind === 'OUTSIDE_GEOFENCE' ? Math.round(between(250, 2900)) : null, at]);
    }
    await insertMany(c, 'attendance_attempts', ['company_id', 'employee_id', 'branch_id', 'qr_code_id', 'attendance_type', 'reason_code', 'message', 'latitude', 'longitude', 'gps_accuracy', 'distance_from_branch', 'created_at'], attempts);

    await c.query(`INSERT INTO audit_logs (company_id, user_id, action, module, new_value) VALUES ($1, NULL, 'seed', 'system', $2)`, [company, JSON.stringify({ employees: employeeCount, days: historyDays })]);
    await c.query('COMMIT');
    log(`Demo company "${co.name}" (code ${co.code}): ${employeeCount} employees, ${rows.length} attendance records over ${historyDays} days.`);
    return { companyId: company as string, adminUserId: staffIds.company_admin, firstEmployeeId: emps[0].id };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export function demoLoginsText() {
  return [
    'QR Attendance - demo log-ins (password for every account: ' + DEMO_PASSWORD + ')',
    '',
    'Admin dashboard  ' + `${config.publicUrl}/admin`,
    '  Super admin     super@qr-attendance.local',
    '  Company admin   admin@camdemo.com',
    '  HR              hr@camdemo.com',
    '  Manager         manager@camdemo.com  or phone 011 222 333   (Sales + Customer Service only)',
    '',
    'Employee app     ' + `${config.publicUrl}/app`,
    '  Company code    camdemo',
    '  Employee ID     E0001 or phone 012 345 678 (Dara Sok, no phone registered yet - the first phone you use is registered)',
    '                  E0002 ... (phones already registered to fake devices, so scans from your phone will be refused)',
    '',
    'Print the QR posters from Admin > QR codes. Branch "CAM Phnom Penh" is at 11.5564, 104.9282 (100 m radius);',
    'to test from elsewhere, edit the branch location to where you are, or raise its radius.',
  ].join('\n');
}

async function main() {
  if (process.argv.includes('--reset')) {
    if (config.isProduction && !process.argv.includes('--force')) throw new Error('Refusing to reset a production database (add --force if you really mean it).');
  }
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    if (process.argv.includes('--reset')) {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('database wiped');
    }
    await runMigrations(pool);
    await seedDemo(pool, { employees: arg('employees', 120), days: arg('days', 30) });
    fs.mkdirSync(config.storageDir, { recursive: true });
    const file = path.join(config.storageDir, 'demo-logins.txt');
    fs.writeFileSync(file, demoLoginsText() + '\n');
    console.log(`\n${demoLoginsText()}\n\n(saved to ${file})`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
