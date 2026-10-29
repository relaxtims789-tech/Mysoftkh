import { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { createApp, FakePhone, Http, login, north, PASSWORD } from './helpers';

/**
 * End-to-end: super admin creates a company, the admin sets it up, employees register phones and scan.
 * Runs against a real PostgreSQL (embedded, started by global-setup.js).
 */
describe('QR attendance (e2e)', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let http: Http;
  let admin: string;
  let branch: { id: string; latitude: number; longitude: number };
  let qrToken: string;
  let qrId: string;
  const BR = { latitude: 11.5564, longitude: 104.9282 };
  const emp: Record<string, { id: string; token: string; phone: FakePhone }> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (url: string, t: string) => (http() as any).get(url).set(auth(t));
  const post = (url: string, t: string, body: unknown = {}) => (http() as any).post(url).set(auth(t)).send(body);
  const put = (url: string, t: string, body: unknown = {}) => (http() as any).put(url).set(auth(t)).send(body);
  const shiftDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);

  /** Every schedule day is a working day and the day spans the whole clock, so tests do not depend on the time they run. */
  async function allDaySchedule() {
    const list = (await get('/api/schedules', admin)).body;
    await put(`/api/schedules/${list[0].id}`, admin, { startTime: '00:00', endTime: '23:59', lunchStart: null, lunchEnd: null, lateAfterMinutes: 0, graceMinutes: 0, workDays: [1, 2, 3, 4, 5, 6, 7] });
  }

  async function addEmployee(code: string, extra: Record<string, unknown> = {}) {
    const res = await post('/api/employees', admin, { employeeCode: code, name: `Employee ${code}`, branchId: branch.id, password: PASSWORD, ...extra });
    expect(res.status).toBe(201);
    const l = await login(http, { companyCode: 'acme', login: code, password: PASSWORD });
    // new employees must change their password before anything else
    expect((await get('/api/attendance/today', l.token)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await put('/api/auth/password', l.token, { currentPassword: PASSWORD, newPassword: 'Changed123' })).status).toBe(200);
    const phone = new FakePhone();
    emp[code] = { id: res.body.employee.id, token: l.token, phone };
    return emp[code];
  }

  beforeAll(async () => {
    ({ app, pool, http } = await createApp());
    const root = await login(http, { login: 'root@test.local', password: PASSWORD });
    const c = await post('/api/companies', root.token, { name: 'Acme Co', code: 'acme', adminName: 'Ann Admin', adminEmail: 'ann@acme.test', adminPassword: PASSWORD, free: true });
    expect(c.status).toBe(201);
    const a = await login(http, { login: 'ann@acme.test', password: PASSWORD });
    await put('/api/auth/password', a.token, { currentPassword: PASSWORD, newPassword: 'AdminPass123' });
    admin = (await login(http, { login: 'ann@acme.test', password: 'AdminPass123' })).token;
    const b = await post('/api/branches', admin, { name: 'CAM Phnom Penh', code: 'PP', ...BR, radius: 100 });
    expect(b.status).toBe(201);
    branch = b.body;
    const q = await post('/api/qr', admin, { branchId: branch.id, label: 'Entrance' });
    expect(q.status).toBe(201);
    qrToken = q.body.token;
    qrId = q.body.id;
    expect(q.body.url).toMatch(new RegExp(`/scan/${qrToken}$`));
    await allDaySchedule();
    await addEmployee('E1');
    await addEmployee('E2');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  describe('authentication', () => {
    it('rejects a wrong password with a generic message', async () => {
      const res = await (http() as any).post('/api/auth/login').send({ companyCode: 'acme', login: 'E1', password: 'nope' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('locks an account after 5 wrong passwords', async () => {
      await post('/api/employees', admin, { employeeCode: 'LOCK1', name: 'Lock Test', password: PASSWORD });
      for (let i = 0; i < 5; i++) await (http() as any).post('/api/auth/login').send({ companyCode: 'acme', login: 'LOCK1', password: 'wrong' });
      const res = await (http() as any).post('/api/auth/login').send({ companyCode: 'acme', login: 'LOCK1', password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('rejects requests without a token', async () => {
      expect((await (http() as any).get('/api/attendance/today')).status).toBe(401);
    });

    it('refresh rotates the cookie; logout ends the session', async () => {
      const l = await login(http, { companyCode: 'acme', login: 'E1', password: 'Changed123' });
      const r1 = await (http() as any).post('/api/auth/refresh').set('Cookie', l.cookie);
      expect(r1.status).toBe(200);
      expect(r1.body.accessToken).toBeTruthy();
      const newCookie = r1.headers['set-cookie'];
      expect((await (http() as any).post('/api/auth/logout').set('Cookie', newCookie)).status).toBe(200);
      expect((await (http() as any).post('/api/auth/refresh').set('Cookie', newCookie)).status).toBe(401);
    });

    it('employees cannot use admin endpoints', async () => {
      expect((await get('/api/employees', emp.E1.token)).status).toBe(403);
      expect((await post('/api/qr', emp.E1.token, { branchId: branch.id })).status).toBe(403);
    });

    it('validates input and rejects unknown fields', async () => {
      const res = await post('/api/branches', admin, { name: 'X', code: 'X1', latitude: 200, longitude: 0 });
      expect(res.status).toBe(400);
      expect((await post('/api/branches', admin, { name: 'X', code: 'X2', latitude: 1, longitude: 1, hacker: true })).status).toBe(400);
    });
  });

  describe('device binding', () => {
    it('first phone is approved automatically, a second phone waits for approval', async () => {
      const r = await emp.E1.phone.register(http, emp.E1.token);
      expect(r.status).toBe(201);
      expect(r.body.device.status).toBe('active');
      const other = new FakePhone();
      const r2 = await other.register(http, emp.E1.token);
      expect(r2.body.device.status).toBe('pending');
      const scan = await post('/api/attendance/check-in', emp.E1.token, await other.scanBody(http, emp.E1.token, { qrToken, ...north(BR.latitude, BR.longitude, 10), accuracy: 10 }));
      expect(scan.status).toBe(403);
      expect(scan.body.code).toBe('DEVICE_PENDING');
    });

    it('an unregistered phone is rejected', async () => {
      const stranger = new FakePhone();
      const res = await post('/api/attendance/scan', emp.E2.token, await stranger.scanBody(http, emp.E2.token, { qrToken, ...BR, accuracy: 10 }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DEVICE_NOT_REGISTERED');
    });
  });

  describe('scan pipeline', () => {
    it('records a check-in inside the geofence', async () => {
      const body = await emp.E1.phone.scanBody(http, emp.E1.token, { qrToken: `http://localhost:3200/scan/${qrToken}`, ...north(BR.latitude, BR.longitude, 40), accuracy: 12 });
      const res = await post('/api/attendance/scan', emp.E1.token, body);
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('check_in');
      expect(res.body.branchName).toBe('CAM Phnom Penh');
      expect(res.body.distance).toBeGreaterThan(35);
      expect(res.body.distance).toBeLessThan(45);
      expect(await count(`SELECT count(*) n FROM attendance WHERE employee_id = $1`, [emp.E1.id])).toBe(1);
    });

    it('a second scan within 30 seconds is "Attendance already recorded." and creates nothing', async () => {
      const res = await post('/api/attendance/scan', emp.E1.token, await emp.E1.phone.scanBody(http, emp.E1.token, { qrToken, ...BR, accuracy: 12 }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_SCAN');
      expect(res.body.message).toBe('Attendance already recorded.');
      expect(await count(`SELECT count(*) n FROM attendance WHERE employee_id = $1`, [emp.E1.id])).toBe(1);
    });

    it('simultaneous scans still create only one record', async () => {
      await emp.E2.phone.register(http, emp.E2.token);
      const bodies = await Promise.all([1, 2, 3].map(() => emp.E2.phone.scanBody(http, emp.E2.token, { qrToken, ...BR, accuracy: 10 })));
      const results = await Promise.all(bodies.map((b) => post('/api/attendance/scan', emp.E2.token, b)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await count(`SELECT count(*) n FROM attendance WHERE employee_id = $1`, [emp.E2.id])).toBe(1);
    });

    it('outside the radius is rejected with the spec message and logged, not recorded', async () => {
      const e = await addEmployee('E3');
      await e.phone.register(http, e.token);
      const res = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken, ...north(BR.latitude, BR.longitude, 250), accuracy: 10 }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OUTSIDE_GEOFENCE');
      expect(res.body.message).toBe('Your location is outside the allowed attendance area.');
      expect(await count(`SELECT count(*) n FROM attendance WHERE employee_id = $1`, [e.id])).toBe(0);
      expect(await count(`SELECT count(*) n FROM attendance_attempts WHERE employee_id = $1 AND reason_code = 'OUTSIDE_GEOFENCE'`, [e.id])).toBe(1);
    });

    it('requires GPS and rejects weak fixes', async () => {
      const e = emp.E3;
      const noGps = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken }));
      expect(noGps.body.code).toBe('GPS_REQUIRED');
      const weak = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken, ...BR, accuracy: 900 }));
      expect(weak.body.code).toBe('GPS_INACCURATE');
    });

    it('rejects a tampered location (signature no longer matches)', async () => {
      const e = emp.E3;
      const body = await e.phone.scanBody(http, e.token, { qrToken, ...north(BR.latitude, BR.longitude, 900), accuracy: 10 });
      body.latitude = BR.latitude; // move the claimed position inside the fence after signing
      const res = await post('/api/attendance/scan', e.token, body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BAD_DEVICE_SIGNATURE');
    });

    it('rejects a replayed challenge', async () => {
      const e = await addEmployee('E4');
      await e.phone.register(http, e.token);
      const body = await e.phone.scanBody(http, e.token, { qrToken, ...BR, accuracy: 10 });
      expect((await post('/api/attendance/scan', e.token, body)).status).toBe(200);
      await pool.query(`UPDATE attendance SET scan_time = scan_time - interval '1 hour' WHERE employee_id = $1`, [e.id]);
      const again = await post('/api/attendance/scan', e.token, body);
      expect(again.body.code).toBe('BAD_CHALLENGE');
    });

    it('rejects invalid, foreign and disabled QR codes', async () => {
      const e = emp.E3;
      expect((await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken: 'https://evil.example/hello', ...BR, accuracy: 5 }))).body.code).toBe('INVALID_QR');
      expect((await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken: 'A'.repeat(43), ...BR, accuracy: 5 }))).body.code).toBe('INVALID_QR');
      const q2 = (await post('/api/qr', admin, { branchId: branch.id })).body;
      await post(`/api/qr/${q2.id}/disable`, admin);
      const res = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken: q2.token, ...BR, accuracy: 5 }));
      expect(res.body.code).toBe('QR_DISABLED');
    });

    it('regenerating a QR makes the printed one stop working', async () => {
      const q3 = (await post('/api/qr', admin, { branchId: branch.id })).body;
      const regen = (await post(`/api/qr/${q3.id}/regenerate`, admin)).body;
      expect(regen.token).not.toBe(q3.token);
      const e = emp.E3;
      const res = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken: q3.token, ...BR, accuracy: 5 }));
      expect(res.body.code).toBe('INVALID_QR');
    });

    it('a second check-in the same day is refused', async () => {
      const e = emp.E1;
      await pool.query(`UPDATE attendance SET scan_time = scan_time - interval '5 minutes' WHERE employee_id = $1`, [e.id]);
      const res = await post('/api/attendance/check-in', e.token, await e.phone.scanBody(http, e.token, { qrToken, ...BR, accuracy: 5 }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_CHECKED_IN');
    });

    it('an early check-out needs confirmation, then is recorded as early leave', async () => {
      const e = emp.E1;
      const first = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken, ...BR, accuracy: 5 }));
      expect(first.status).toBe(409);
      expect(first.body.code).toBe('CONFIRM_EARLY_CHECKOUT');
      const ok = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken, ...BR, accuracy: 5, confirmEarly: true }));
      expect(ok.status).toBe(200);
      expect(ok.body.type).toBe('check_out');
      expect(ok.body.status).toBe('early_leave');
      const today = (await get('/api/attendance/today', e.token)).body;
      expect(today.records.map((r: any) => r.type)).toEqual(['check_in', 'check_out']);
      expect(today.summary.flags).toContain('early_leave');
    });

    it('with GPS and device binding switched off, a plain scan works', async () => {
      await put('/api/settings/attendance-rules', admin, { requireGps: false, requireDeviceBinding: false });
      const e = await addEmployee('E5');
      const res = await post('/api/attendance/check-in', e.token, { qrToken });
      expect(res.status).toBe(200);
      await put('/api/settings/attendance-rules', admin, { requireGps: true, requireDeviceBinding: true });
    });

    it('home-branch restriction', async () => {
      const b2 = (await post('/api/branches', admin, { name: 'Siem Reap', code: 'SR', latitude: 13.3633, longitude: 103.8564 })).body;
      const q = (await post('/api/qr', admin, { branchId: b2.id })).body;
      await put('/api/settings/attendance-rules', admin, { restrictToHomeBranch: true });
      const e = emp.E3;
      const res = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken: q.token, latitude: 13.3633, longitude: 103.8564, accuracy: 5 }));
      expect(res.body.code).toBe('WRONG_BRANCH');
      await put('/api/settings/attendance-rules', admin, { restrictToHomeBranch: false });
    });

    it('a QR from another company is not accepted', async () => {
      const root = await login(http, { login: 'root@test.local', password: PASSWORD });
      await post('/api/companies', root.token, { name: 'Other', code: 'other', adminName: 'O', adminEmail: 'o@other.test', adminPassword: PASSWORD });
      const companyId = (await pool.query(`SELECT id FROM companies WHERE code = 'other'`)).rows[0].id;
      const ob = (await (http() as any).post('/api/branches').set(auth(root.token)).set('x-company-id', companyId).send({ name: 'HQ', code: 'HQ', ...BR })).body;
      const oq = (await (http() as any).post('/api/qr').set(auth(root.token)).set('x-company-id', companyId).send({ branchId: ob.id })).body;
      const e = emp.E3;
      const res = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken: oq.token, ...BR, accuracy: 5 }));
      expect(res.body.code).toBe('INVALID_QR');
      // and the other company's admin cannot see Acme's employees
      const o = await login(http, { login: 'o@other.test', password: PASSWORD });
      await put('/api/auth/password', o.token, { currentPassword: PASSWORD, newPassword: 'OtherPass123' });
      expect((await get(`/api/employees/${emp.E1.id}`, o.token)).status).toBe(404);
      expect((await get('/api/employees', o.token)).body.total).toBe(0);
    });
  });

  describe('overtime pay, split and approval', () => {
    /** Most recent past date (Phnom Penh) with the given ISO weekday, at least 2 days ago. */
    function lastWeekday(iso: number) {
      const d = new Date(Date.now() + 7 * 3600000);
      d.setUTCDate(d.getUTCDate() - 2);
      while (((d.getUTCDay() + 6) % 7) + 1 !== iso) d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }

    it('prices OT per hour on work days and per day on days off; approval controls what counts', async () => {
      const sched = (await post('/api/schedules', admin, { name: 'Office 8-5', startTime: '08:00', endTime: '17:00', lateAfterMinutes: 15, graceMinutes: 5, workDays: [1, 2, 3, 4, 5] })).body;
      const e = await addEmployee('OT1', { scheduleId: sched.id, monthlySalary: 416 });
      const policy = await put('/api/overtime/policy', admin, {
        currency: 'USD', monthlyHours: 208, workDay: { mode: 'multiplier', value: 1.5 },
        dayOff: { mode: 'fixed_day', value: 15, minHours: 4 }, holiday: { mode: 'multiplier', value: 2 },
      });
      expect(policy.status).toBe(200);

      const wed = lastWeekday(3);
      const sun = lastWeekday(7);
      const key = (await post('/api/integrations/keys', admin, { name: 'OT test' })).body.key;
      const punches = [
        { employeeCode: 'OT1', time: `${wed}T08:00:00+07:00`, type: 'check_in', externalId: 'ot1-1' },
        { employeeCode: 'OT1', time: `${wed}T18:30:00+07:00`, type: 'check_out', externalId: 'ot1-2' },
        { employeeCode: 'OT1', time: `${sun}T09:00:00+07:00`, type: 'check_in', externalId: 'ot1-3' },
        { employeeCode: 'OT1', time: `${sun}T14:00:00+07:00`, type: 'check_out', externalId: 'ot1-4' },
      ];
      expect((await (http() as any).post('/api/integrations/punches').set('x-api-key', key).send({ punches })).body.created).toBe(4);

      const from = sun < wed ? sun : wed;
      const to = sun < wed ? wed : sun;
      const payRow = async () => { const b = (await get(`/api/reports/overtime-pay?from=${from}&to=${to}&employeeId=${e.id}`, admin)).body; return b.rows[0]; };
      // $416 / 208 h = $2/h. Wednesday 1.5 h x 1.5 x $2 = $4.50; Sunday 5 h >= 4 h -> $15 for the day.
      expect(await payRow()).toMatchObject({ hourlyRate: 2, otWorkDay: 1.5, otDayOff: 5, otDays: 2, paidDays: 1, weighted: 2.25, amount: 19.5 });

      // monthly summary shows the split
      const monthly = (await get(`/api/reports/monthly?from=${from}&to=${to}&employeeId=${e.id}`, admin)).body;
      expect(monthly.columns.map((c: any) => c.key)).toEqual(expect.arrayContaining(['otWorkDay', 'otDayOff', 'otHoliday', 'otDays']));
      expect(monthly.rows[0]).toMatchObject({ otWorkDay: 1.5, otDayOff: 5, otDays: 2 });

      // approval on: nothing counts until approved
      await put('/api/overtime/policy', admin, { requiresApproval: true });
      expect(await payRow()).toMatchObject({ amount: 0, pending: 6.5 });
      await post('/api/overtime/reason', e.token, { workDate: wed, reason: 'Stock count' });
      const pending = (await get(`/api/overtime?from=${from}&to=${to}&status=pending&employeeId=${e.id}`, admin)).body.rows;
      expect(pending).toHaveLength(2);
      expect(pending.find((r: any) => r.workDate === wed).reason).toBe('Stock count');

      // approve 60 of 90 minutes on Wednesday, reject Sunday
      const rev = await post('/api/overtime/review', admin, { items: [
        { employeeId: e.id, workDate: wed, decision: 'approve', minutes: 60 },
        { employeeId: e.id, workDate: sun, decision: 'reject', note: 'Not requested' },
      ] });
      expect(rev.body.reviewed).toBe(2);
      expect(await payRow()).toMatchObject({ otWorkDay: 1, otDayOff: 0, amount: 3 });
      const mine = (await get(`/api/overtime/mine?from=${from}&to=${to}`, e.token)).body;
      expect(mine.days.map((d: any) => d.status).sort()).toEqual(['approved', 'rejected']);
      expect(await count(`SELECT count(*) n FROM audit_logs WHERE module = 'overtime' AND action IN ('approve', 'reject')`)).toBe(2);

      await put('/api/overtime/policy', admin, { requiresApproval: false });
    });
  });

  describe('payroll', () => {
    it('works out pay, tax and NSSF; locks the month on approval; only a company admin unlocks', async () => {
      const now = new Date(Date.now() + 7 * 3600000);
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      const month = prev.toISOString().slice(0, 7);
      const days = Array.from({ length: prev.getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
      const weekdays = days.filter((d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; });

      const sched = (await post('/api/schedules', admin, { name: 'Payroll 8-5', startTime: '08:00', endTime: '17:00', lateAfterMinutes: 15, graceMinutes: 5, workDays: [1, 2, 3, 4, 5] })).body;
      const e = await addEmployee('PAY1', {
        scheduleId: sched.id, monthlySalary: 520, hiredOn: '2020-01-01', dependents: 1, bankName: 'ABA Bank', bankAccount: '000 123 456', bankAccountName: 'PAY ONE',
      });
      // works every weekday of the month except the first one (absent = 1 unpaid day)
      const key = (await post('/api/integrations/keys', admin, { name: 'Payroll test' })).body.key;
      const punches = weekdays.slice(1).flatMap((d, i) => [
        { employeeCode: 'PAY1', time: `${d}T07:55:00+07:00`, type: 'check_in', externalId: `pay-${i}-in` },
        { employeeCode: 'PAY1', time: `${d}T17:05:00+07:00`, type: 'check_out', externalId: `pay-${i}-out` },
      ]);
      expect((await (http() as any).post('/api/integrations/punches').set('x-api-key', key).send({ punches })).body.created).toBe(punches.length);

      const settings = (await get('/api/payroll/settings', admin)).body;
      expect(settings).toMatchObject({ currency: 'USD', fixedDays: 26, tax: true, nssf: true, exchangeRate: 4100, dependentAllowance: 150000 });
      expect(settings.taxBrackets).toHaveLength(5);

      expect((await post(`/api/payroll/employees/${e.id}/allowances`, admin, { name: 'Transport', amount: 20 })).status).toBe(201);
      expect((await post(`/api/payroll/employees/${e.id}/allowances`, admin, { name: 'Meal', amount: 10, tax: 'exempt' })).status).toBe(201);

      const calc = await post(`/api/payroll/runs/${month}/calculate`, admin, { exchangeRate: 4100 });
      expect(calc.status).toBe(200);
      expect(calc.body.run.status).toBe('draft');
      const lineOf = async () => (await get(`/api/payroll/runs/${month}`, admin)).body.lines.find((l: any) => l.employeeId === e.id);
      let line = calc.body.lines.find((l: any) => l.employeeId === e.id);
      // $520 / 26 days = $20 a day; 1 absent day. Gross 500 + 20 + 10 = 530, taxable 520 (meal is tax-free).
      expect(line).toMatchObject({ salary: 520, dailyRate: 20, unpaidDays: 1, basePay: 500, gross: 530, taxableGross: 520 });
      expect(line.days).toMatchObject({ absent: 1, worked: weekdays.length - 1 });
      expect(line.nssf).toMatchObject({ wageKhr: 1200000, employeeKhr: 24000, employee: 5.85 });
      // 2,132,000 - 24,000 pension - 150,000 dependant = 1,958,000 -> 5% over 1.5M = 22,900 riel
      expect(line.tax).toMatchObject({ baseKhr: 1958000, taxKhr: 22900, tax: 5.59 });
      expect(line.net).toBe(518.56);

      // one-off deduction and an advance refresh the draft line straight away
      const item = await post('/api/payroll/items', admin, { employeeId: e.id, month, kind: 'deduction', name: 'Uniform', amount: 5 });
      expect(item.status).toBe(201);
      const adv = await post('/api/payroll/advances', admin, { employeeId: e.id, amount: 120, installment: 50, startMonth: month, issuedOn: `${month}-02` });
      expect(adv.status).toBe(201);
      line = await lineOf();
      expect(line).toMatchObject({ deductionsTotal: 5, advancesTotal: 50, totalDeductions: 66.44, net: 463.56 });
      expect(line.advances[0]).toMatchObject({ amount: 50, balance: 70 });
      expect(line.bank).toMatchObject({ name: 'ABA Bank', account: '000 123 456' });

      // drafts are not visible to the employee
      expect((await get('/api/payroll/mine', e.token)).body).toEqual([]);
      expect((await get(`/api/payroll/mine/${month}`, e.token)).status).toBe(404);
      expect((await get('/api/payroll/runs', e.token)).status).toBe(403);

      // HR prepares payroll but cannot approve or unlock
      const hrUser = (await post('/api/users', admin, { name: 'Pay HR', email: 'payhr@acme.test', role: 'hr' })).body;
      const hr1 = await login(http, { login: 'payhr@acme.test', password: hrUser.temporaryPassword });
      await put('/api/auth/password', hr1.token, { currentPassword: hrUser.temporaryPassword, newPassword: 'HrPass1234' });
      const hr = (await login(http, { login: 'payhr@acme.test', password: 'HrPass1234' })).token;
      expect((await post(`/api/payroll/runs/${month}/calculate`, hr)).status).toBe(200);
      expect((await post(`/api/payroll/runs/${month}/approve`, hr)).status).toBe(403);
      expect((await put('/api/payroll/settings', hr, { tax: false })).status).toBe(403);

      const approved = await post(`/api/payroll/runs/${month}/approve`, admin);
      expect(approved.status).toBe(200);
      expect(approved.body.run.status).toBe('approved');
      expect(approved.body.run.approvedBy).toBe('Ann Admin');
      expect((await get(`/api/payroll/advances?employeeId=${e.id}`, admin)).body[0]).toMatchObject({ repaid: 50, balance: 70, status: 'active' });

      // locked: no recalculation, no new items, no attendance changes in that month
      expect((await post(`/api/payroll/runs/${month}/calculate`, admin)).body.code).toBe('PAYROLL_LOCKED');
      expect((await post('/api/payroll/items', admin, { employeeId: e.id, month, kind: 'earning', name: 'Bonus', amount: 9 })).body.code).toBe('PAYROLL_LOCKED');
      expect((await post('/api/overtime/review', admin, { items: [{ employeeId: e.id, workDate: weekdays[3], decision: 'approve' }] })).body.code).toBe('PAYROLL_LOCKED');

      // the employee sees the payslip now
      const mine = (await get('/api/payroll/mine', e.token)).body;
      expect(mine).toEqual([expect.objectContaining({ month, status: 'approved', net: 463.56 })]);
      const pdf = await get(`/api/payroll/mine/${month}/pdf`, e.token).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');

      // exports
      const bank = await get(`/api/payroll/runs/${month}/export?kind=bank&format=csv`, admin);
      expect(bank.status).toBe(200);
      expect(bank.text).toContain('000 123 456');
      expect(bank.text).toContain('463.56');
      const summary = await get(`/api/payroll/runs/${month}/export?kind=summary&format=xlsx`, admin).buffer(true);
      expect(summary.headers['content-type']).toContain('spreadsheetml');
      expect((await get(`/api/payroll/runs/${month}/export?kind=payslips&employeeId=${e.id}`, admin).buffer(true)).headers['content-type']).toBe('application/pdf');

      expect((await post(`/api/payroll/runs/${month}/paid`, admin)).body.run.status).toBe('paid');
      expect((await post(`/api/payroll/runs/${month}/unlock`, hr, { reason: 'Fix bonus' })).status).toBe(403);
      expect((await post(`/api/payroll/runs/${month}/unlock`, admin, {})).status).toBe(400);
      const unlocked = await post(`/api/payroll/runs/${month}/unlock`, admin, { reason: 'Add missing bonus' });
      expect(unlocked.body.run.status).toBe('draft');
      expect((await get(`/api/payroll/advances?employeeId=${e.id}`, admin)).body[0]).toMatchObject({ repaid: 0, balance: 120 });
      expect((await post('/api/payroll/items', admin, { employeeId: e.id, month, kind: 'earning', name: 'Bonus', amount: 9 })).status).toBe(201);
      expect((await lineOf()).gross).toBe(539);
      expect(await count(`SELECT count(*) n FROM audit_logs WHERE module = 'payroll' AND action IN ('approve', 'paid', 'unlock')`)).toBe(3);
      expect((await (http() as any).delete(`/api/payroll/runs/${month}`).set(auth(admin))).status).toBe(200);
    });
  });

  describe('sign-up, free trial, plans and payment', () => {
    const ppToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const shift = (d: string, days: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

    it('website sign-up starts a trial; staff limit, bank transfer, approval, read-only after grace, PayWay', async () => {
      const root = (await login(http, { login: 'root@test.local', password: PASSWORD })).token;
      const plans = (await (http() as any).get('/api/public/plans')).body;
      expect(plans.tiers).toHaveLength(11);
      expect(plans.tiers[0]).toMatchObject({ minStaff: 1, maxStaff: 5 });
      expect(plans.tiers[10]).toMatchObject({ minStaff: 2001, maxStaff: 3000 });
      expect(plans.payment).toEqual({ payway: false, banks: [] });

      // super admin: 2-month trial, prices, bank account
      expect((await put('/api/platform/settings', admin, { trialMonths: 2 })).status).toBe(403);
      const st = await put('/api/platform/settings', root, { trialMonths: 2, yearlyFreeMonths: 2, abaAccountName: 'MYSOFT KH', abaAccountNumber: '000 111 222', salesPhone: '012 000 111' });
      expect(st.status).toBe(200);
      const tiers = (await get('/api/platform/tiers', root)).body;
      tiers[0].monthlyPrice = 10;
      tiers[1].monthlyPrice = 15;
      expect((await put('/api/platform/tiers', root, { tiers: tiers.map(({ id, minStaff, maxStaff, monthlyPrice }: any) => ({ id, minStaff, maxStaff, monthlyPrice })) })).status).toBe(200);
      const t5 = tiers[0].id;
      const t10 = tiers[1].id;

      const signup = (body: object) => (http() as any).post('/api/public/signup').send({
        companyName: 'Lucky Shop', fullName: 'Lucky Owner', email: 'owner@lucky.test', phone: '015 222 333', password: 'Lucky1234', tierId: t5, acceptTerms: true, ...body,
      });
      expect((await signup({ website: 'http://spam' })).body.code).toBe('REJECTED');
      expect((await signup({ acceptTerms: false })).status).toBe(400);
      const s = await signup({});
      expect(s.status).toBe(201);
      expect(s.body.companyCode).toBe('luckyshop');
      expect(s.headers['set-cookie'].join(';')).toContain('qra_rt=');
      const today = ppToday();
      const [y, m, d] = today.split('-').map(Number);
      const twoMonths = new Date(Date.UTC(y, m - 1 + 2, 1));
      twoMonths.setUTCDate(Math.min(d, new Date(Date.UTC(twoMonths.getUTCFullYear(), twoMonths.getUTCMonth() + 1, 0)).getUTCDate()));
      expect(s.body.trialEndsAt).toBe(shift(twoMonths.toISOString().slice(0, 10), -1));
      expect(s.body.user.company.billing).toMatchObject({ state: 'trial', readOnly: false });
      expect((await signup({})).body.code).toBe('EMAIL_TAKEN');
      const owner = s.body.accessToken;
      // the owner can sign in again with email or phone
      expect((await login(http, { login: '015222333', password: 'Lucky1234' })).token).toBeTruthy();

      // plan 1-5 staff: the 6th active employee is refused
      for (let i = 1; i <= 5; i++) expect((await post('/api/employees', owner, { employeeCode: `L${i}`, name: `Lucky ${i}`, password: PASSWORD })).status).toBe(201);
      const sixth = await post('/api/employees', owner, { employeeCode: 'L6', name: 'Lucky 6', password: PASSWORD });
      expect(sixth.body.code).toBe('STAFF_LIMIT');
      // during the trial the plan can be changed freely
      const bill = (await post('/api/billing/plan', owner, { tierId: t10 })).body;
      expect(bill.tier.maxStaff).toBe(10);
      expect((await post('/api/employees', owner, { employeeCode: 'L6', name: 'Lucky 6', password: PASSWORD })).status).toBe(201);
      expect((await post('/api/billing/plan', owner, { tierId: t5 })).body.code).toBe('PLAN_TOO_SMALL');

      // invoice: monthly 15, starting the day after the trial
      const inv = await post('/api/billing/invoices', owner, { tierId: t10, cycle: 'monthly' });
      expect(inv.status).toBe(201);
      expect(inv.body).toMatchObject({ amount: 15, months: 1, status: 'unpaid', periodStart: shift(s.body.trialEndsAt, 1) });
      const yearly = (await post('/api/billing/invoices', owner, { tierId: t10, cycle: 'yearly' })).body;
      expect(yearly).toMatchObject({ amount: 150, months: 12 });
      expect((await post(`/api/billing/invoices/${yearly.id}/payway`, owner, { policyVersion: '1.0' })).body.code).toBe('PAYWAY_OFF');

      // every payment needs the current Cancellation & Refund Policy accepted
      const overview0 = (await get('/api/billing', owner)).body;
      expect(overview0.refundPolicyVersion).toBe('1.0');
      const noPolicy = await (http() as any).post(`/api/billing/invoices/${yearly.id}/transfer`).set(auth(owner)).field('bank', 'aba').attach('file', PNG, 'receipt.png');
      expect(noPolicy.body).toMatchObject({ code: 'POLICY_NOT_ACCEPTED', details: { version: '1.0' } });
      const oldPolicy = await (http() as any).post(`/api/billing/invoices/${yearly.id}/transfer`).set(auth(owner)).field('bank', 'aba').field('policyVersion', '0.9').attach('file', PNG, 'receipt.png');
      expect(oldPolicy.body.code).toBe('POLICY_NOT_ACCEPTED');

      // bank transfer with a receipt; the super admin approves
      const overview = (await get('/api/billing', owner)).body;
      expect(overview.invoices.filter((i: any) => i.status === 'unpaid')).toHaveLength(1);
      expect(overview.payment.banks[0]).toMatchObject({ bank: 'aba', accountNumber: '000 111 222' });
      expect((await (http() as any).post(`/api/billing/invoices/${yearly.id}/transfer`).set(auth(owner)).field('bank', 'aba').field('policyVersion', '1.0').attach('file', Buffer.from('not an image'), 'x.png')).body.code).toBe('BAD_FILE_TYPE');
      const tr = await (http() as any).post(`/api/billing/invoices/${yearly.id}/transfer`).set(auth(owner)).field('bank', 'aba').field('note', 'Paid from ABA app').field('policyVersion', '1.0').attach('file', PNG, 'receipt.png');
      expect(tr.status).toBe(200);
      const accepted = (await get('/api/platform/invoices?status=submitted', root)).body.find((i: any) => i.id === yearly.id);
      expect(accepted).toMatchObject({ policyVersion: '1.0', policyAcceptedBy: expect.any(String) });
      expect(accepted.policyAcceptedAt).toBeTruthy();
      const rc = await get(`/api/billing/invoices/${yearly.id}/receipt`, root);
      expect(rc.headers['content-type']).toBe('image/png');
      expect((await get(`/api/billing/invoices/${yearly.id}/receipt`, admin)).status).toBe(404);
      const toCheck = (await get('/api/platform/invoices?status=submitted', root)).body;
      expect(toCheck.map((i: any) => i.id)).toContain(yearly.id);
      expect((await post(`/api/platform/invoices/${yearly.id}/approve`, root, { note: 'Checked ABA statement' })).status).toBe(200);
      const after = (await get('/api/billing', owner)).body;
      expect(after.status.state).toBe('active');
      expect(after.paidUntil).toBe(shift(twoMonths.toISOString().slice(0, 10).replace(/^(\d{4})/, (y0) => String(Number(y0) + 1)), -1));
      expect(after.invoices.find((i: any) => i.id === yearly.id)).toMatchObject({ status: 'paid', method: 'bank_transfer' });

      // trial and paid period over: 7 grace days, then read-only (view, export and pay still work)
      const subs = (await get('/api/platform/subscriptions', root)).body;
      const lucky = subs.find((c: any) => c.code === 'luckyshop');
      expect(lucky).toMatchObject({ source: 'website', staffCount: 6, exempt: false });
      expect(subs.find((c: any) => c.code === 'acme').billing.state).toBe('exempt');
      await put(`/api/platform/companies/${lucky.id}/billing`, root, { trialEndsAt: shift(today, -40), paidUntil: shift(today, -3) });
      expect((await get('/api/billing', owner)).body.status.state).toBe('grace');
      expect((await post('/api/branches', owner, { name: 'Shop', code: 'S1', latitude: 11.5, longitude: 104.9 })).status).toBe(201);
      await put(`/api/platform/companies/${lucky.id}/billing`, root, { paidUntil: shift(today, -8) });
      const blocked = await post('/api/branches', owner, { name: 'Shop 2', code: 'S2', latitude: 11.5, longitude: 104.9 });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('SUBSCRIPTION_EXPIRED');
      expect((await get('/api/employees', owner)).status).toBe(200);
      expect((await get('/api/auth/me', owner)).body.company.billing).toMatchObject({ state: 'expired', readOnly: true });
      const renew = await post('/api/billing/invoices', owner, { tierId: t10, cycle: 'monthly' });
      expect(renew.status).toBe(201);
      expect(renew.body.periodStart).toBe(today);

      // ABA PayWay: signed checkout form, then the pushback is confirmed with PayWay before the plan is extended
      await put('/api/platform/settings', root, { paywayEnabled: true, paywaySandbox: true, paywayMerchantId: 'mysoft', paywayApiKey: 'secret-key-123' });
      const set = (await get('/api/platform/settings', root)).body;
      expect(set).toMatchObject({ paywayReady: true, paywayApiKeySet: true });
      expect(JSON.stringify(set)).not.toContain('secret-key-123');
      expect((await post(`/api/billing/invoices/${renew.body.id}/payway`, owner)).body.code).toBe('POLICY_NOT_ACCEPTED');
      const form = (await post(`/api/billing/invoices/${renew.body.id}/payway`, owner, { policyVersion: '1.0' })).body;
      expect(form.action).toBe('https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase');
      expect(form.fields).toMatchObject({ merchant_id: 'mysoft', amount: '15.00', currency: 'USD', type: 'purchase' });
      const order = ['req_time', 'merchant_id', 'tran_id', 'amount', 'items', 'shipping', 'firstname', 'lastname', 'email', 'phone', 'type', 'payment_option', 'return_url', 'cancel_url', 'continue_success_url', 'return_deeplink', 'currency', 'custom_fields', 'return_params', 'payout', 'lifetime', 'additional_params', 'google_pay_token', 'skip_success_page'];
      const crypto = await import('crypto');
      expect(form.fields.hash).toBe(crypto.createHmac('sha512', 'secret-key-123').update(order.map((k) => form.fields[k] ?? '').join('')).digest('base64'));
      expect(Buffer.from(form.fields.return_url, 'base64').toString()).toMatch(/\/api\/public\/payway\/callback$/);

      const { BillingService } = await import('../src/modules/billing/billing.service');
      const billing = app.get(BillingService);
      let paywayAnswer: any = { data: { payment_status_code: 0, payment_status: 'APPROVED', payment_amount: 10, payment_currency: 'USD', status: { code: '00', message: 'Success!' } } };
      const calls: any[] = [];
      billing.paywayFetch = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { json: async () => paywayAnswer } as any; }) as any;
      // too little money: not paid
      expect((await (http() as any).post('/api/public/payway/callback').send({ tran_id: form.fields.tran_id, status: 0 })).body.ok).toBe(false);
      expect(calls[0].url).toBe('https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/check-transaction-2');
      expect(calls[0].body.hash).toBe(crypto.createHmac('sha512', 'secret-key-123').update(calls[0].body.req_time + 'mysoft' + form.fields.tran_id).digest('base64'));
      paywayAnswer = { data: { ...paywayAnswer.data, payment_amount: 15 } };
      expect((await (http() as any).post('/api/public/payway/callback').send({ tran_id: form.fields.tran_id })).body.ok).toBe(true);
      const paid = (await get('/api/billing', owner)).body;
      expect(paid.status.state).toBe('active');
      expect(paid.invoices.find((i: any) => i.id === renew.body.id)).toMatchObject({ status: 'paid', method: 'payway', policyVersion: '1.0' });
      // writes work again; the 6-10 staff plan allows 1 branch
      const second = await post('/api/branches', owner, { name: 'Shop 2', code: 'S2', latitude: 11.5, longitude: 104.9 });
      expect(second.body).toMatchObject({ code: 'BRANCH_LIMIT', details: { limit: 1, used: 1 } });
      expect((await get('/api/branches/allowance', owner)).body).toEqual({ used: 1, limit: 1, source: 'plan' });
      expect((await get('/api/billing', owner)).body).toMatchObject({ branchCount: 1, branchLimit: 1, tier: { maxBranches: 1 } });
      expect((await (http() as any).get('/api/public/plans')).body.tiers.map((t: any) => t.maxBranches)).toEqual([1, 1, 2, 2, 10, 10, null, null, null, null, null]);
      // the super admin allows this company 3 branches, then unlimited, then back to the plan
      const luckyId = lucky.id;
      expect((await put(`/api/platform/companies/${luckyId}/billing`, root, { branchLimitCustom: true, branchLimit: 3 })).body).toMatchObject({ branchLimit: 3, branchLimitCustom: true });
      const s2 = await post('/api/branches', owner, { name: 'Shop 2', code: 'S2', latitude: 11.5, longitude: 104.9 });
      expect(s2.status).toBe(201);
      expect((await post('/api/branches', owner, { name: 'Shop 3', code: 'S3', latitude: 11.5, longitude: 104.9 })).status).toBe(201);
      expect((await post('/api/branches', owner, { name: 'Shop 4', code: 'S4', latitude: 11.5, longitude: 104.9 })).body.code).toBe('BRANCH_LIMIT');
      expect((await put(`/api/platform/companies/${luckyId}/billing`, root, { branchLimitCustom: true, branchLimit: null })).body.branchLimit).toBeNull();
      expect((await post('/api/branches', owner, { name: 'Shop 4', code: 'S4', latitude: 11.5, longitude: 104.9, status: 'inactive' })).status).toBe(201);
      await put(`/api/platform/companies/${luckyId}/billing`, root, { branchLimitCustom: false });
      // back on the plan with 3 active branches: re-activating a 4th is refused
      const s4 = (await get('/api/branches', owner)).body.find((b: any) => b.code === 'S4');
      expect((await put(`/api/branches/${s4.id}`, owner, { status: 'active' })).body.code).toBe('BRANCH_LIMIT');

      // a smaller plan must still fit the active branches
      expect((await post('/api/billing/invoices', owner, { tierId: tiers[2].id, cycle: 'monthly' })).body.code).toBe('PLAN_TOO_FEW_BRANCHES');
      for (const b of (await get('/api/branches', owner)).body.filter((x: any) => x.code === 'S2' || x.code === 'S3')) await put(`/api/branches/${b.id}`, owner, { status: 'inactive' });

      // upgrade during a paid period: difference for the months left
      const up = (await post('/api/billing/invoices', owner, { tierId: tiers[2].id, cycle: 'monthly' })).body;
      expect(up).toMatchObject({ kind: 'upgrade', months: 1, amount: tiers[2].monthlyPrice - 15 });
      expect((await post('/api/billing/plan', owner, { tierId: tiers[2].id })).body.code).toBe('PLAN_PAID');
      expect(await count(`SELECT count(*) n FROM audit_logs WHERE module = 'invoices' AND action = 'paid'`)).toBe(2);
    });
  });

  describe('Telegram Mini App', () => {
    it('links once, then signs in with Telegram; bot /start links from the browser; staff get messages and reminders', async () => {
      const { signInitData } = await import('../src/common/telegram-init-data');
      const { TelegramService } = await import('../src/modules/core/telegram.service');
      const { TelegramAppService } = await import('../src/modules/telegram/telegram.module');
      const tg = app.get(TelegramService);
      const TOKEN = '7000001:TEST-bot-token';
      const initData = (userId: number, lang = 'km', token = TOKEN) => {
        const fields = { query_id: 'AAE', user: JSON.stringify({ id: userId, first_name: 'Test', username: `u${userId}`, language_code: lang }), auth_date: String(Math.floor(Date.now() / 1000)) };
        return new URLSearchParams({ ...fields, hash: signInitData(fields, token) }).toString();
      };
      const root = (await login(http, { login: 'root@test.local', password: PASSWORD })).token;
      expect((await post('/api/auth/telegram', '', { initData: initData(777) })).body.code).toBe('TELEGRAM_NOT_SET');
      expect((await put('/api/platform/settings', root, { telegramBotToken: TOKEN })).status).toBe(200);
      // the bot set-up needs the real https address
      expect((await post('/api/platform/telegram/setup', root)).body.code).toBe('NEEDS_HTTPS');
      await pool.query(`UPDATE platform_settings SET telegram_bot_username = 'mysoft_test_bot', telegram_webhook_secret = 'hook-secret-1234'`);

      // not linked yet -> sign in with the password once, then link
      const tgLogin = () => (http() as any).post('/api/auth/telegram').send({ initData: initData(777) });
      expect((await tgLogin()).body.code).toBe('TELEGRAM_NOT_LINKED');
      expect((await (http() as any).post('/api/auth/telegram').send({ initData: initData(777, 'km', '1:other-bot') })).body.code).toBe('TELEGRAM_INVALID');
      const e1 = emp.E1;
      tg.sent.length = 0;
      const linked = await post('/api/auth/telegram/link', e1.token, { initData: initData(777) });
      expect(linked.body).toMatchObject({ linked: true, username: 'u777', notify: true, botUsername: 'mysoft_test_bot' });
      await new Promise((r) => setTimeout(r, 50));
      expect(tg.sent.find((m) => m.body.chat_id === 777)?.body.text).toContain('Telegram បានភ្ជាប់');
      const s = await tgLogin();
      expect(s.status).toBe(200);
      expect(s.body.user.employee.code).toBe('E1');
      expect((await get('/api/attendance/today', s.body.accessToken)).status).toBe(200);

      // messages: leave decision in the staff member's Telegram language, with a button that opens the app
      tg.sent.length = 0;
      const day = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
      const lv = await post('/api/leave', e1.token, { leaveType: 'annual', startDate: day, endDate: day, reason: 'Family' });
      expect(lv.status).toBe(201);
      expect((await post(`/api/leave/${lv.body.id}/approve`, admin, { note: 'Enjoy' })).status).toBe(200);
      await new Promise((r) => setTimeout(r, 100));
      const msg = tg.sent.find((m) => m.body.chat_id === 777);
      expect(msg?.body.text).toContain('ច្បាប់ប្រចាំឆ្នាំ');
      expect(msg?.body.text).toContain('Enjoy');
      expect(msg?.body.reply_markup.inline_keyboard[0][0].web_app.url).toMatch(/\/app\/leave$/);

      // notifications off -> nothing more is sent
      await put('/api/auth/telegram/notify', e1.token, { notify: false });
      tg.sent.length = 0;
      const lv2 = (await post('/api/leave', e1.token, { leaveType: 'sick', startDate: shiftDays(day, 2), endDate: shiftDays(day, 2), reason: 'Flu' })).body;
      await post(`/api/leave/${lv2.id}/reject`, admin, { note: 'No' });
      await new Promise((r) => setTimeout(r, 100));
      expect(tg.sent.filter((m) => m.body.chat_id === 777)).toHaveLength(0);
      await put('/api/auth/telegram/notify', e1.token, { notify: true });

      // from the browser app: a one-time t.me link; pressing Start in the bot connects the account
      const link = (await post('/api/auth/telegram/connect-link', emp.E2.token)).body.url as string;
      expect(link).toMatch(/^https:\/\/t\.me\/mysoft_test_bot\?start=[A-Za-z0-9_-]+$/);
      const code = link.split('start=')[1];
      const hook = (secret: string, text: string, from = 888) => (http() as any).post('/api/public/telegram/webhook').set('x-telegram-bot-api-secret-token', secret)
        .send({ update_id: 1, message: { message_id: 1, from: { id: from, language_code: 'en', username: 'dara' }, chat: { id: from, type: 'private' }, text } });
      expect((await hook('wrong', `/start ${code}`)).status).toBe(401);
      tg.sent.length = 0;
      expect((await hook('hook-secret-1234', `/start ${code}`)).status).toBe(200);
      expect((await get('/api/auth/telegram/status', emp.E2.token)).body).toMatchObject({ linked: true, username: 'dara' });
      await new Promise((r) => setTimeout(r, 50));
      expect(tg.sent.find((m) => m.body.chat_id === 888)?.body.text).toContain('Telegram is now connected');
      await hook('hook-secret-1234', `/start ${code}`, 889); // used once only
      expect(tg.sent.find((m) => m.body.chat_id === 889)?.body.text).toContain('expired');
      await hook('hook-secret-1234', '/start', 890);
      expect(tg.sent.find((m) => m.body.chat_id === 890)?.body.reply_markup.inline_keyboard[0][0].web_app.url).toMatch(/\/app$/);

      // forgot to check out: one reminder an hour after the end of work
      const sched = (await post('/api/schedules', admin, { name: 'Shop 8-5', startTime: '08:00', endTime: '17:00', lateAfterMinutes: 15, graceMinutes: 5, workDays: [1, 2, 3, 4, 5, 6, 7] })).body;
      const r1 = await addEmployee('TG1', { scheduleId: sched.id });
      await pool.query('UPDATE users SET telegram_user_id = 999 WHERE employee_id = $1', [r1.id]);
      const key = (await post('/api/integrations/keys', admin, { name: 'TG test' })).body.key;
      const inAt = new Date(Date.now() - 60_000).toISOString();
      expect((await (http() as any).post('/api/integrations/punches').set('x-api-key', key).send({ punches: [{ employeeCode: 'TG1', time: inAt, type: 'check_in', externalId: 'tg1-in' }] })).body.created).toBe(1);
      const pp = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      const reminders = app.get(TelegramAppService);
      tg.sent.length = 0;
      expect(await reminders.sendCheckoutReminders(new Date(`${pp}T17:30:00+07:00`))).toEqual({ sent: 0 });
      expect(await reminders.sendCheckoutReminders(new Date(`${pp}T18:05:00+07:00`))).toEqual({ sent: 1 });
      expect(await reminders.sendCheckoutReminders(new Date(`${pp}T18:15:00+07:00`))).toEqual({ sent: 0 });
      await new Promise((r) => setTimeout(r, 100));
      expect(tg.sent.find((m) => m.body.chat_id === 999)?.body.text).toContain("haven't checked out");
      expect(await count(`SELECT count(*) n FROM audit_logs WHERE module = 'telegram' AND action = 'link'`)).toBe(2);
    });
  });

  describe('Telegram admin bot', () => {
    it('admins only; alerts for requests, refused scans, morning summary and absentees, filtered for managers', async () => {
      const { signInitData } = await import('../src/common/telegram-init-data');
      const { TelegramService } = await import('../src/modules/core/telegram.service');
      const { TelegramAppService } = await import('../src/modules/telegram/telegram.module');
      const tg = app.get(TelegramService);
      const ADMIN_TOKEN = '7000002:TEST-admin-bot';
      const initData = (userId: number, token = ADMIN_TOKEN) => {
        const fields = { query_id: 'AAF', user: JSON.stringify({ id: userId, first_name: 'Boss', username: `b${userId}`, language_code: 'en' }), auth_date: String(Math.floor(Date.now() / 1000)) };
        return new URLSearchParams({ ...fields, hash: signInitData(fields, token) }).toString();
      };
      const root = (await login(http, { login: 'root@test.local', password: PASSWORD })).token;
      expect((await put('/api/platform/settings', root, { telegramAdminBotToken: ADMIN_TOKEN, telegramBotToken: '7000001:TEST-bot-token' })).status).toBe(200);
      expect((await get('/api/platform/settings', root)).body).toMatchObject({ telegramAdminBotTokenSet: true });
      await pool.query(`UPDATE platform_settings SET telegram_bot_username = 'mysoft_test_bot', telegram_admin_bot_username = 'mysoft_admin_bot', telegram_admin_webhook_secret = 'admin-secret-1234'`);
      const tgLogin = (id: number) => (http() as any).post('/api/auth/telegram').send({ initData: initData(id), bot: 'admin' });

      // staff cannot use the admin bot
      const e1 = emp.E1;
      expect((await post('/api/auth/telegram/link', e1.token, { initData: initData(4001), bot: 'admin' })).body.code).toBe('TELEGRAM_ADMIN_ONLY');
      await pool.query('UPDATE users SET telegram_user_id = 4001 WHERE employee_id = $1', [e1.id]);
      expect((await tgLogin(4001)).body.code).toBe('TELEGRAM_ADMIN_ONLY');
      await pool.query('UPDATE users SET telegram_user_id = NULL WHERE employee_id = $1', [e1.id]);

      // the admin links once, then Telegram signs them in
      expect((await tgLogin(5001)).body.code).toBe('TELEGRAM_NOT_LINKED');
      const st = await post('/api/auth/telegram/link', admin, { initData: initData(5001), bot: 'admin' });
      expect(st.body).toMatchObject({ linked: true, adminAvailable: true, adminBotUsername: 'mysoft_admin_bot', adminNotify: true });
      expect(st.body.adminAlerts.sort()).toEqual(['late_absent', 'rejected', 'requests', 'summary']);
      const s = await tgLogin(5001);
      expect(s.status).toBe(200);
      expect(s.body.user.role).toBe('company_admin');

      // a manager of an empty department gets nothing about others
      const dep = (await post('/api/departments', admin, { name: 'TG Dept' })).body;
      const mgr = (await post('/api/users', admin, { name: 'TG Manager', email: 'tgmgr@acme.test', role: 'manager', departmentIds: [dep.id] })).body;
      await pool.query('UPDATE users SET telegram_user_id = 5002 WHERE id = $1', [mgr.id]);

      const wait = () => new Promise((r) => setTimeout(r, 120));
      const toChat = (chat: number) => tg.sent.filter((m) => m.bot === 'admin' && m.body.chat_id === chat);

      // new leave request -> admin, with a button to the approvals page
      tg.sent.length = 0;
      const day = shiftDays(new Date().toISOString().slice(0, 10), 40);
      expect((await post('/api/leave', emp.E2.token, { leaveType: 'personal', startDate: day, endDate: day, reason: 'Wedding' })).status).toBe(201);
      await wait();
      expect(toChat(5001)[0].body.text).toContain('Leave request: Employee E2 (E2)');
      expect(toChat(5001)[0].body.reply_markup.inline_keyboard[0][0].web_app.url).toMatch(/\/manage\/approvals$/);
      expect(toChat(5002)).toHaveLength(0);

      // refused scan -> one alert, then quiet for 15 minutes
      tg.sent.length = 0;
      const bad = { qrToken: 'not-a-real-qr-token-123', latitude: 11.5, longitude: 104.9, accuracy: 10 };
      expect((await post('/api/attendance/scan', emp.E2.token, bad)).body.code).toBe('INVALID_QR');
      await post('/api/attendance/scan', emp.E2.token, bad);
      await wait();
      expect(toChat(5001).filter((m) => m.body.text.includes('Scan refused'))).toHaveLength(1);

      // the admin turns refused-scan alerts off
      await put('/api/auth/telegram/admin-alerts', admin, { alerts: ['requests', 'summary', 'late_absent'] });
      tg.sent.length = 0;
      await post('/api/attendance/scan', e1.token, bad);
      await wait();
      expect(toChat(5001)).toHaveLength(0);

      // daily: absent list + morning summary, once per day
      expect((await put('/api/auth/telegram/summary-time', admin, { time: '07:30' })).status).toBe(200);
      expect((await get('/api/auth/telegram/summary-time', admin)).body.time).toBe('07:30');
      const daily = app.get(TelegramAppService);
      const pp = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      tg.sent.length = 0;
      const first = await daily.sendDailyAlerts(new Date(`${pp}T23:00:00+07:00`));
      expect(first.summary).toBe(1);
      await wait();
      const texts = toChat(5001).map((m) => m.body.text as string);
      expect(texts.some((t) => t.startsWith('📊 Attendance'))).toBe(true);
      expect(toChat(5002)).toHaveLength(0);
      expect(await daily.sendDailyAlerts(new Date(`${pp}T23:10:00+07:00`))).toEqual({ summary: 0, absent: 0 });

      // admin bot /start
      tg.sent.length = 0;
      await (http() as any).post('/api/public/telegram/admin-webhook').set('x-telegram-bot-api-secret-token', 'admin-secret-1234')
        .send({ update_id: 2, message: { message_id: 2, from: { id: 5003, language_code: 'km' }, chat: { id: 5003, type: 'private' }, text: '/start' } });
      expect(tg.sent[0]).toMatchObject({ bot: 'admin' });
      expect(tg.sent[0].body.reply_markup.inline_keyboard[0][0].web_app.url).toMatch(/\/manage$/);
      expect((await (http() as any).post('/api/public/telegram/admin-webhook').set('x-telegram-bot-api-secret-token', 'hook-secret-1234').send({})).status).toBe(401);
    });
  });

  describe('website visitor counter', () => {
    const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
    const PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36';
    const visit = (ua: string, body: Record<string, unknown>) => (http() as any).post('/api/public/visit').set('User-Agent', ua).send(body);

    it('counts page views anonymously, skips bots and quick repeats; only the super admin sees the numbers', async () => {
      expect((await visit(DESKTOP, { visitorId: 'visitor-one-123', path: '/', lang: 'en', referrer: 'https://m.facebook.com/somepost' })).body).toEqual({ counted: true });
      expect((await visit(DESKTOP, { visitorId: 'visitor-one-123', path: '/' })).body).toEqual({ counted: false }); // refresh
      expect((await visit(DESKTOP, { visitorId: 'visitor-one-123', path: '/signup', lang: 'en' })).body).toEqual({ counted: true });
      expect((await visit(PHONE, { visitorId: 'visitor-two-456', path: '/', lang: 'km', referrer: 'https://google.com/' })).body).toEqual({ counted: true });
      expect((await visit('Googlebot/2.1 (+http://www.google.com/bot.html)', { visitorId: 'crawler-000001', path: '/' })).body).toEqual({ counted: false });
      expect((await visit(DESKTOP, { visitorId: 'x', path: '/' })).status).toBe(400);
      expect((await visit(DESKTOP, { visitorId: 'visitor-one-123', path: 'https://evil.example/' })).status).toBe(400);
      expect(await count(`SELECT count(*) AS n FROM site_visits WHERE visitor LIKE 'visitor%'`)).toBe(0); // ids are stored only as keyed hashes

      const root = (await login(http, { login: 'root@test.local', password: PASSWORD })).token;
      const s = (await get('/api/platform/visitors?days=7', root)).body;
      expect(s).toMatchObject({ days: 7, online: 2, today: { views: 3, visitors: 2 }, week: { views: 3, visitors: 2 } });
      expect(s.daily).toHaveLength(7);
      expect(s.daily[6]).toMatchObject({ views: 3, visitors: 2 });
      expect(s.pages).toEqual(expect.arrayContaining([{ name: '/', views: 2, visitors: 2 }, { name: '/signup', views: 1, visitors: 1 }]));
      expect(s.referrers.map((r: any) => r.name)).toEqual(expect.arrayContaining(['facebook.com', 'google.com', '']));
      expect(s.devices).toEqual(expect.arrayContaining([{ name: 'desktop', views: 2, visitors: 1 }, { name: 'mobile', views: 1, visitors: 1 }]));
      expect((await get('/api/platform/visitors', admin)).status).toBe(403);
    });
  });

  describe('small decimal radius', () => {
    it('accepts 0.5 m to 5000 m with up to 2 decimals and applies it', async () => {
      const make = (radius: unknown, code: string) => post('/api/branches', admin, { name: `Tiny ${code}`, code, latitude: 11.6, longitude: 104.9, radius });
      expect((await make(0.4, 'T1')).status).toBe(400);
      expect((await make(1.234, 'T2')).status).toBe(400);
      expect((await make(5000.5, 'T3')).status).toBe(400);
      const tiny = await make(0.5, 'T4');
      expect(tiny.status).toBe(201);
      expect(tiny.body.radius).toBe(0.5);
      expect((await put(`/api/branches/${tiny.body.id}`, admin, { radius: 2.25 })).body.radius).toBe(2.25);
      expect((await put('/api/settings/attendance-rules', admin, { geofenceRadius: 12.5 })).body.geofenceRadius).toBe(12.5);
      await put('/api/settings/attendance-rules', admin, { geofenceRadius: 100 });

      // 2.25 m: 1.5 m away is inside, 3 m away is outside
      const q = (await post('/api/qr', admin, { branchId: tiny.body.id })).body;
      const e = await addEmployee('TINY1');
      await e.phone.register(http, e.token);
      const far = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken: q.token, ...north(11.6, 104.9, 3), accuracy: 5 }));
      expect(far.body.code).toBe('OUTSIDE_GEOFENCE');
      expect(far.body.details.radius).toBe(2.25);
      const near = await post('/api/attendance/scan', e.token, await e.phone.scanBody(http, e.token, { qrToken: q.token, ...north(11.6, 104.9, 1.5), accuracy: 5 }));
      expect(near.status).toBe(200);
    });
  });

  describe('check-in / check-out buttons (no QR)', () => {
    /** A signed button request: the phone signs "BUTTON" where a scan signs the QR token. */
    async function buttonBody(e: { token: string; phone: FakePhone }, p: { type: string; latitude?: number; longitude?: number; accuracy?: number; confirmEarly?: boolean }) {
      const body: any = await e.phone.scanBody(http, e.token, { qrToken: 'BUTTON', ...p });
      delete body.qrToken;
      return body;
    }

    it('is refused while the company setting is off', async () => {
      const e = await addEmployee('BTN1');
      await e.phone.register(http, e.token);
      const res = await post('/api/attendance/punch', e.token, await buttonBody(e, { type: 'check_in', ...BR, accuracy: 8 }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BUTTON_CHECKIN_DISABLED');
    });

    it('when on: records at the branch the phone is in, with GPS and phone checks', async () => {
      expect((await put('/api/settings/attendance-rules', admin, { allowButtonCheckin: true })).body.allowButtonCheckin).toBe(true);
      const e = emp.BTN1;
      const today = (await get('/api/attendance/today', e.token)).body;
      expect(today.rules.allowButtonCheckin).toBe(true);

      const outside = await post('/api/attendance/punch', e.token, await buttonBody(e, { type: 'check_in', ...north(BR.latitude, BR.longitude, 400), accuracy: 8 }));
      expect(outside.status).toBe(403);
      expect(outside.body.code).toBe('OUTSIDE_GEOFENCE');
      expect(outside.body.details.branch).toBe('CAM Phnom Penh');

      const ok = await post('/api/attendance/punch', e.token, await buttonBody(e, { type: 'check_in', ...north(BR.latitude, BR.longitude, 30), accuracy: 8 }));
      expect(ok.status).toBe(200);
      expect(ok.body.type).toBe('check_in');
      expect(ok.body.branchName).toBe('CAM Phnom Penh');
      const rec = (await pool.query(`SELECT source, qr_code_id, branch_id FROM attendance WHERE id = $1`, [ok.body.record.id])).rows[0];
      expect(rec).toMatchObject({ source: 'button', qr_code_id: null, branch_id: branch.id });

      // tampering with the signed location still fails
      const forged = await buttonBody(e, { type: 'check_out', ...north(BR.latitude, BR.longitude, 900), accuracy: 8 });
      forged.latitude = BR.latitude;
      expect((await post('/api/attendance/punch', e.token, forged)).body.code).toBe('BAD_DEVICE_SIGNATURE');

      // early check-out asks for confirmation, then records
      await pool.query(`UPDATE attendance SET scan_time = scan_time - interval '10 minutes' WHERE employee_id = $1`, [e.id]);
      const early = await post('/api/attendance/punch', e.token, await buttonBody(e, { type: 'check_out', ...BR, accuracy: 8 }));
      expect(early.body.code).toBe('CONFIRM_EARLY_CHECKOUT');
      const out = await post('/api/attendance/punch', e.token, await buttonBody(e, { type: 'check_out', ...BR, accuracy: 8, confirmEarly: true }));
      expect(out.status).toBe(200);
      expect(out.body.type).toBe('check_out');
    });

    it('picks the nearest branch the phone is inside', async () => {
      const e = await addEmployee('BTN2');
      await e.phone.register(http, e.token);
      const res = await post('/api/attendance/punch', e.token, await buttonBody(e, { type: 'check_in', latitude: 13.3634, longitude: 103.8565, accuracy: 8 }));
      expect(res.status).toBe(200);
      expect(res.body.branchName).toBe('Siem Reap');
      await put('/api/settings/attendance-rules', admin, { allowButtonCheckin: false });
    });
  });

  describe('sign in with a phone number', () => {
    it('staff: phone only, any way of typing it; duplicates refused', async () => {
      const created = await post('/api/users', admin, { name: 'Sao', phone: '012 777 888', role: 'hr' });
      expect(created.status).toBe(201);
      expect(created.body.signIn).toBe('012 777 888');
      for (const typed of ['012 777 888', '+855 12 777 888', '85512777888']) {
        const res = await (http() as any).post('/api/auth/login').send({ login: typed, password: created.body.temporaryPassword });
        expect(res.status).toBe(200);
        expect(res.body.user.name).toBe('Sao');
      }
      expect((await post('/api/users', admin, { name: 'Other', phone: '+85512777888', role: 'manager' })).body.code).toBe('DUPLICATE');
      expect((await post('/api/users', admin, { name: 'Nobody', role: 'manager' })).body.code).toBe('SIGN_IN_REQUIRED');
      const wrong = await (http() as any).post('/api/auth/login').send({ login: '012 777 888', password: 'nope' });
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('employees: company code + phone number instead of the employee ID', async () => {
      await post('/api/employees', admin, { employeeCode: 'PH1', name: 'Phone Person', phone: '097 555 4444', password: PASSWORD });
      const res = await (http() as any).post('/api/auth/login').send({ companyCode: 'acme', login: '+855 97 555 4444', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.employee.code).toBe('PH1');
      // changing the phone on the employee record moves the sign-in with it
      const id = res.body.user.employee.id;
      await put(`/api/employees/${id}`, admin, { phone: '010 101 010' });
      expect((await (http() as any).post('/api/auth/login').send({ companyCode: 'acme', login: '097 555 4444', password: PASSWORD })).status).toBe(401);
      expect((await (http() as any).post('/api/auth/login').send({ companyCode: 'acme', login: '010101010', password: PASSWORD })).status).toBe(200);
    });
  });

  describe('phone registered once (device cookie)', () => {
    /** Registers a key the way a browser would, sending and keeping cookies like that browser. */
    async function registerWithJar(e: { token: string }, phone: FakePhone, jar: string[]) {
      const { challenge } = (await get('/api/attendance/challenge', e.token)).body;
      const { registerMessage } = await import('../src/modules/devices/challenge.service');
      const res = await (http() as any)
        .post('/api/devices/register')
        .set(auth(e.token))
        .set('Cookie', jar.join('; '))
        .send({ publicKey: phone.jwk, deviceName: 'iPhone', platform: 'iOS', challenge, signature: phone.sign(registerMessage(challenge)) });
      for (const c of (res.headers['set-cookie'] as unknown as string[]) ?? []) {
        const pair = c.split(';')[0];
        const name = pair.split('=')[0];
        const i = jar.findIndex((x) => x.startsWith(`${name}=`));
        if (i >= 0) jar.splice(i, 1);
        jar.push(pair);
      }
      return res;
    }

    it('same browser that lost its key stays registered without approval; another browser still needs approval', async () => {
      const e = await addEmployee('DEV1');
      const jar: string[] = [];
      const first = await registerWithJar(e, new FakePhone(), jar);
      expect(first.body.device.status).toBe('active');
      expect(jar.some((c) => c.startsWith('qra_dev_'))).toBe(true);
      expect(first.body.deviceToken).toBeUndefined(); // the token is only ever in the httpOnly cookie

      // The browser forgot its key (iPhone Chrome, cleared storage...) but still has the cookie.
      const newKey = new FakePhone();
      const again = await registerWithJar(e, newKey, jar);
      expect(again.body.device.status).toBe('active');
      expect(await count(`SELECT count(*) n FROM devices WHERE employee_id = $1`, [e.id])).toBe(1);
      expect(await count(`SELECT count(*) n FROM audit_logs WHERE module = 'devices' AND action = 'rekey'`)).toBe(1);
      const scan = await post('/api/attendance/check-in', e.token, await newKey.scanBody(http, e.token, { qrToken, ...BR, accuracy: 8 }));
      expect(scan.status).toBe(200);

      // A different browser/app on the phone (no cookie) is a new device and waits for approval, with a clear reason.
      const other = await registerWithJar(e, new FakePhone(), []);
      expect(other.body.device.status).toBe('pending');
      expect(other.body.message).toMatch(/another phone or browser/);
    });
  });

  describe('admin side', () => {
    it('approving a pending phone makes it the only active one', async () => {
      const pending = (await get('/api/devices?status=pending', admin)).body;
      expect(pending.length).toBeGreaterThan(0);
      const res = await post(`/api/devices/${pending[0].id}/approve`, admin);
      expect(res.body.status).toBe('active');
      expect(await count(`SELECT count(*) n FROM devices WHERE employee_id = $1 AND status = 'active'`, [pending[0].employeeId])).toBe(1);
    });

    it('reset device lets the employee register a new phone', async () => {
      await post(`/api/employees/${emp.E2.id}/reset-device`, admin);
      const fresh = new FakePhone();
      const r = await fresh.register(http, emp.E2.token);
      expect(r.body.device.status).toBe('active');
    });

    it('corrections: employee requests, HR approves, record and audit log are written', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const req = await post('/api/corrections', emp.E3.token, { workDate: yesterday, attendanceType: 'check_in', time: '08:03', reason: 'Forgot to scan' });
      expect(req.status).toBe(201);
      expect(req.body.status).toBe('pending');
      const ok = await post(`/api/corrections/${req.body.id}/approve`, admin, { note: 'OK' });
      expect(ok.body.status).toBe('approved');
      expect(await count(`SELECT count(*) n FROM attendance WHERE employee_id = $1 AND source = 'correction' AND work_date = $2`, [emp.E3.id, yesterday])).toBe(1);
      expect(await count(`SELECT count(*) n FROM audit_logs WHERE module = 'attendance_corrections' AND record_id = $1`, [req.body.id])).toBe(2);
      expect(await count(`SELECT count(*) n FROM audit_logs WHERE module = 'attendance' AND action = 'correct'`)).toBe(1);
    });

    it('manager sees only their departments', async () => {
      const dep = (await post('/api/departments', admin, { name: 'Sales' })).body;
      await put(`/api/employees/${emp.E1.id}`, admin, { departmentId: dep.id });
      const created = (await post('/api/users', admin, { name: 'Mike', email: 'mike@acme.test', role: 'manager', departmentIds: [dep.id] })).body;
      const m = await login(http, { login: 'mike@acme.test', password: created.temporaryPassword });
      await put('/api/auth/password', m.token, { currentPassword: created.temporaryPassword, newPassword: 'Manager123' });
      const list = (await get('/api/employees', m.token)).body;
      expect(list.items.map((e: any) => e.employeeCode)).toEqual(['E1']);
      expect((await get(`/api/employees/${emp.E2.id}`, m.token)).status).toBe(404);
      expect((await post('/api/employees', m.token, { employeeCode: 'X', name: 'X' })).status).toBe(403);
    });

    it('dashboard, live view and reports', async () => {
      const d = (await get('/api/dashboard', admin)).body;
      expect(d.counts.totalEmployees).toBeGreaterThanOrEqual(5);
      expect(d.counts.present).toBeGreaterThanOrEqual(3);
      const live = (await get('/api/attendance/live', admin)).body;
      expect(live.rows.find((r: any) => r.employeeCode === 'E1').checkOut).toBeTruthy();
      for (const t of ['daily', 'monthly', 'late', 'absent', 'overtime', 'early-leave', 'exceptions', 'department', 'branch', 'leave']) {
        const r = await get(`/api/reports/${t}`, admin);
        expect(r.status).toBe(200);
        expect(Array.isArray(r.body.rows)).toBe(true);
      }
      for (const f of ['csv', 'xlsx', 'pdf']) {
        const r = await get(`/api/reports/export?type=daily&format=${f}`, admin).buffer(true);
        expect(r.status).toBe(200);
        expect(Number(r.headers['content-length'] ?? r.body.length)).toBeGreaterThan(100);
      }
    });

    it('QR print data includes an SVG and the company name', async () => {
      const p = (await get(`/api/qr/${qrId}/print`, admin)).body;
      expect(p.svg).toContain('<svg');
      expect(p.companyName).toBe('Acme Co');
      const resolve = (await (http() as any).get(`/api/qr/resolve/${qrToken}`)).body;
      expect(resolve).toMatchObject({ valid: true, branchName: 'CAM Phnom Penh' });
    });

    it('leave: request, approve, shows in the leave report', async () => {
      const next = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const l = await post('/api/leave', emp.E2.token, { leaveType: 'annual', startDate: next, endDate: next, reason: 'Trip' });
      expect(l.status).toBe(201);
      expect((await post(`/api/leave/${l.body.id}/approve`, admin)).body.status).toBe('approved');
      expect((await post('/api/leave', emp.E2.token, { leaveType: 'sick', startDate: next, endDate: next })).body.code).toBe('LEAVE_OVERLAP');
    });

    it('integrations: ZKTeco punches land in the same table, idempotently', async () => {
      const key = (await post('/api/integrations/keys', admin, { name: 'ZK bridge' })).body.key;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const body = { punches: [
        { employeeCode: 'E4', time: `${yesterday}T08:01:00+07:00`, externalId: 'ZK1:1', method: 'fingerprint' },
        { employeeCode: 'E4', time: `${yesterday}T17:02:00+07:00`, externalId: 'ZK1:2', method: 'face' },
        { employeeCode: 'NOPE', time: `${yesterday}T08:00:00+07:00`, externalId: 'ZK1:3' },
      ] };
      const r1 = await (http() as any).post('/api/integrations/punches').set('x-api-key', key).send(body);
      expect(r1.body.created).toBe(2);
      expect(r1.body.results.map((r: any) => r.type ?? r.result)).toEqual(['check_in', 'check_out', 'unknown_employee']);
      const r2 = await (http() as any).post('/api/integrations/punches').set('x-api-key', key).send(body);
      expect(r2.body.created).toBe(0);
      expect((await (http() as any).post('/api/integrations/punches').set('x-api-key', 'qra_wrong').send(body)).status).toBe(401);
    });

    it('audit log records admin changes', async () => {
      const res = (await get('/api/audit-logs?module=attendance_rules', admin)).body;
      expect(res.total).toBeGreaterThan(0);
    });
  });

  describe('Telegram groups', () => {
    it('admin connects a group through the bot; it gets check-ins, check-outs, leave and fix-scan requests as chosen', async () => {
      const { TelegramService } = await import('../src/modules/core/telegram.service');
      const tg = app.get(TelegramService);
      const root = (await login(http, { login: 'root@test.local', password: PASSWORD })).token;
      await put('/api/platform/settings', root, { telegramAdminBotToken: '7000002:TEST-admin-token', telegramBotToken: '7000001:TEST-bot-token' });
      await pool.query(`UPDATE platform_settings SET telegram_admin_bot_username = 'mysoft_admin_bot', telegram_admin_webhook_secret = 'admin-secret-1234', telegram_admin_setup_at = now()`);
      tg.forgetToken();
      const sentTo = (chat: number) => tg.sent.filter((m) => Number(m.body.chat_id) === chat);
      const settle = () => new Promise((r) => setTimeout(r, 80));

      expect((await get('/api/telegram-groups', admin)).body).toMatchObject({ available: true, botUsername: 'mysoft_admin_bot', groups: [] });
      expect((await get('/api/telegram-groups', emp.E1.token)).status).toBe(403);
      const link = (await post('/api/telegram-groups/connect-link', admin)).body;
      expect(link.url).toMatch(/^https:\/\/t\.me\/mysoft_admin_bot\?startgroup=[A-Za-z0-9_-]{8,}$/);
      const code = link.url.split('startgroup=')[1];
      const hook = (update: any, secret = 'admin-secret-1234') => (http() as any).post('/api/public/telegram/admin-webhook').set('x-telegram-bot-api-secret-token', secret).send(update);
      const groupMsg = (text: string, chatId = -100555) => ({ update_id: 1, message: { message_id: 5, date: 0, chat: { id: chatId, type: 'supergroup', title: 'Acme attendance' }, from: { id: 900, first_name: 'Ann' }, text } });

      // Telegram adds the bot to the chosen group and posts /start <code> there
      tg.sent.length = 0;
      expect((await hook(groupMsg(`/start@mysoft_admin_bot ${code}`))).status).toBe(200);
      let groups = (await get('/api/telegram-groups', admin)).body.groups;
      expect(groups).toEqual([expect.objectContaining({ title: 'Acme attendance', active: true, lang: 'km', branchId: null, events: ['check_in', 'check_out', 'leave', 'correction'] })]);
      expect(sentTo(-100555)[0].body.text).toContain('Acme Co');
      // a code works once; other chatter in the group is ignored
      tg.sent.length = 0;
      await hook(groupMsg(`/connect ${code}`, -100777));
      expect(sentTo(-100777)[0].body.text).toContain('expired');
      expect((await hook(groupMsg('hello everyone'))).status).toBe(200);
      expect((await pool.query('SELECT count(*)::int AS n FROM telegram_groups')).rows[0].n).toBe(1);

      // leave and fix-scan requests from staff are posted, with a button to review them
      tg.sent.length = 0;
      const d = shiftDays(new Date().toISOString().slice(0, 10), 45);
      expect((await post('/api/leave', emp.E1.token, { leaveType: 'annual', startDate: d, endDate: d, reason: 'Trip' })).status).toBe(201);
      const yday = shiftDays(new Date().toISOString().slice(0, 10), -3);
      expect((await post('/api/corrections', emp.E2.token, { workDate: yday, attendanceType: 'check_out', time: '17:05', reason: 'Phone died' })).status).toBe(201);
      await settle();
      const posted = sentTo(-100555).map((m) => m.body);
      expect(posted.find((b) => b.text.includes('សំណើច្បាប់'))?.reply_markup.inline_keyboard[0][0].url).toMatch(/\/admin\/leave$/);
      expect(posted.find((b) => b.text.includes('សំណើកែតម្រូវ'))?.text).toContain('Phone died');

      // English, check-ins only, this branch only: a button check-in is posted, a check-out is not
      const g = groups[0];
      expect((await put(`/api/telegram-groups/${g.id}`, admin, { events: [] })).body.code).toBe('NO_EVENTS');
      await put(`/api/telegram-groups/${g.id}`, admin, { lang: 'en', events: ['check_in'], branchId: branch.id });
      await put('/api/settings/attendance-rules', admin, { allowButtonCheckin: true });
      const e = await addEmployee('GRP1');
      await e.phone.register(http, e.token);
      const button = async (type: string) => {
        const body: any = await e.phone.scanBody(http, e.token, { qrToken: 'BUTTON', type, ...BR, accuracy: 8, confirmEarly: true });
        delete body.qrToken;
        return post('/api/attendance/punch', e.token, body);
      };
      tg.sent.length = 0;
      expect((await button('check_in')).status).toBe(200);
      await settle();
      expect(sentTo(-100555).map((m) => m.body.text)).toEqual([expect.stringMatching(/^🟢 Employee GRP1 \(GRP1\) · Checked in .*\n📍 CAM Phnom Penh/)]);
      await pool.query(`UPDATE attendance SET scan_time = scan_time - interval '10 minutes' WHERE employee_id = $1`, [e.id]);
      tg.sent.length = 0;
      expect((await button('check_out')).status).toBe(200);
      await settle();
      expect(sentTo(-100555)).toHaveLength(0);
      await put('/api/settings/attendance-rules', admin, { allowButtonCheckin: false });

      // test message; group upgraded to a supergroup is followed; the bot removed from the group switches it off
      tg.sent.length = 0;
      expect((await post(`/api/telegram-groups/${g.id}/test`, admin)).body).toEqual({ ok: true });
      expect(sentTo(-100555)[0].body.text).toContain('Test message');
      await hook({ update_id: 2, message: { message_id: 6, date: 0, chat: { id: -100555, type: 'group', title: 'Acme attendance' }, migrate_to_chat_id: -100999 } });
      await hook({ update_id: 3, my_chat_member: { chat: { id: -100999, type: 'supergroup' }, from: { id: 900 }, date: 0, old_chat_member: { status: 'member' }, new_chat_member: { status: 'kicked', user: { id: 1 } } } });
      groups = (await get('/api/telegram-groups', admin)).body.groups;
      expect(groups[0]).toMatchObject({ active: false, statusNote: 'The bot was removed from the group' });
      // removing it makes the bot leave the group
      tg.sent.length = 0;
      expect((await (http() as any).delete(`/api/telegram-groups/${g.id}`).set(auth(admin))).body.groups).toEqual([]);
      expect(Number(tg.sent.find((m) => m.method === 'leaveChat')?.body.chat_id)).toBe(-100999);
      expect((await hook({}, 'wrong-secret-12345678')).status).toBe(401);
    });
  });
});
