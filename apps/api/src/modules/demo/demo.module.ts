import { Controller, Get, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AuthUser, Public } from '../../common/auth';
import { config } from '../../config';
import { Db } from '../../database/db.service';
import { DEMO_EMAIL_DOMAIN, DEMO_EMPLOYEE_ID, DEMO_TZ, demoStart, isDemoStale } from '../../database/demo-data';
import { addDays, localParts } from '../../domain/time';
import { PayrollModule } from '../payroll/payroll.module';
import { PayrollService } from '../payroll/payroll.service';

/** Sign-ins every visitor shares; they can be used but not changed. */
export const demoLogins = () => ({
  admin: config.demoCompanyCode,
  hr: `hr@${DEMO_EMAIL_DOMAIN}`,
  manager: `manager@${DEMO_EMAIL_DOMAIN}`,
});

const monthOf = (date: string) => date.slice(0, 7);
function nextMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
/** Last day of a YYYY-MM month. */
const monthEnd = (month: string) => addDays(`${nextMonth(month)}-01`, -1);

/** Public demo (DEMO_MODE): payroll history after the nightly rebuild, the nightly restart, and the visitor guard. */
@Injectable()
export class DemoService implements OnModuleDestroy {
  private readonly log = new Logger('Demo');
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Db, private readonly payroll: PayrollService) {}

  /** Payroll for every month of the history: older months paid, last month approved, this month a draft. */
  async ensurePayroll() {
    const c = await this.db.maybeOne('SELECT id FROM companies WHERE lower(code) = lower($1)', [config.demoCompanyCode]);
    if (!c) return;
    if (await this.db.maybeOne('SELECT 1 FROM payroll_runs WHERE company_id = $1 LIMIT 1', [c.id])) return;
    const admin = await this.db.one(`SELECT id, name FROM users WHERE company_id = $1 AND role = 'company_admin' ORDER BY created_at LIMIT 1`, [c.id]);
    const user: AuthUser = { id: admin.id, role: 'company_admin', name: admin.name, companyId: c.id, employeeId: null, departmentIds: null, mustChangePassword: false };
    const today = localParts(new Date(), DEMO_TZ).date;
    const months: string[] = [];
    for (let m = monthOf(demoStart(today)); m < monthOf(today); m = nextMonth(m)) months.push(m);
    if (!months.length) return;

    // A few pay items so payslips show more than salary: a bonus, a deduction and a salary advance paid back monthly.
    const emps = await this.db.query(`SELECT id, employee_code FROM employees WHERE company_id = $1 ORDER BY employee_code LIMIT 12`, [c.id]);
    const last = months[months.length - 1];
    await this.payroll.addItem(user, { employeeId: emps[0].id, month: last, kind: 'earning', name: 'Sales bonus', amount: 80 }, 'demo');
    await this.payroll.addItem(user, { employeeId: emps[3].id, month: last, kind: 'earning', name: 'Sales bonus', amount: 45 }, 'demo');
    await this.payroll.addItem(user, { employeeId: emps[5].id, month: last, kind: 'deduction', name: 'Lost ID card', amount: 5 }, 'demo');
    if (months.length >= 3) {
      await this.payroll.addAdvance(user, { employeeId: emps[8].id, amount: 150, installment: 50, startMonth: months[months.length - 3], issuedOn: `${months[months.length - 3]}-10`, note: 'School fees' }, 'demo');
    }

    for (const m of months) {
      await this.payroll.calculate(user, m, undefined, 'demo');
      await this.payroll.approve(user, m, 'demo');
      if (m !== last) await this.payroll.markPaid(user, m, 'demo');
      // Dates as if the payroll had been done at each month end.
      const end = monthEnd(m);
      await this.db.query(
        `UPDATE payroll_runs SET calculated_at = $3::date + time '17:00' - interval '7 hours', approved_at = $3::date + time '17:30' - interval '7 hours',
                paid_at = CASE WHEN status = 'paid' THEN $4::date + time '10:00' - interval '7 hours' END
          WHERE company_id = $1 AND month = $2::date`,
        [c.id, `${m}-01`, end, addDays(end, 3)],
      );
    }
    await this.payroll.calculate(user, monthOf(today), undefined, 'demo');
    this.log.log(`payroll for ${months.join(', ')} (paid / approved) and ${monthOf(today)} (draft)`);
  }

  /** Every few minutes: once a new demo day starts, exit so Docker restarts the app, which rebuilds the data. */
  startNightlyReset() {
    this.timer = setInterval(async () => {
      try {
        if (await isDemoStale(this.db.pool)) {
          this.log.warn('new demo day: restarting to rebuild the demo data');
          setTimeout(() => process.exit(0), 500);
        }
      } catch (e) {
        this.log.error(`demo check failed: ${(e as Error).message}`);
      }
    }, 5 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Express middleware: refuses changes that would break the demo for the next visitor (passwords, the shared
   * sign-ins and the demo employee, the company code, attendance rules, billing, sign-up, Telegram and API keys).
   */
  guard() {
    const deny = (res: Response, message: string) =>
      res.status(403).json({ statusCode: 403, code: 'DEMO_LOCKED', message: `${message} This is the demo; sign up for your own free trial at ${config.mainSiteUrl}` });
    const fixed: [RegExp, string][] = [
      [/^\/api\/auth\/password$/, 'Passwords cannot be changed in the demo.'],
      [/^\/api\/auth\/telegram(\/|$)/, 'Telegram is not connected in the demo.'],
      [/^\/api\/telegram-groups(\/|$)/, 'Telegram groups are not connected in the demo.'],
      [/^\/api\/companies(\/|$)(?!current\/logo$)/, 'Company details are fixed in the demo.'],
      [/^\/api\/settings\/attendance-rules$/, 'Attendance rules are fixed in the demo.'],
      [/^\/api\/(billing|platform)(\/|$)/, 'Billing is not available in the demo.'],
      [/^\/api\/public\/signup$/, 'Sign-up is not available in the demo.'],
      [/^\/api\/integrations\/keys(\/|$)/, 'API keys are not available in the demo.'],
    ];
    return async (req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
      const p = req.path;
      for (const [re, message] of fixed) if (re.test(p)) return deny(res, message);
      try {
        const u = p.match(/^\/api\/users\/([0-9a-f-]{36})(\/reset-password)?$/i);
        if (u) {
          const l = demoLogins();
          const hit = await this.db.maybeOne(
            `SELECT 1 FROM users WHERE id = $1 AND (lower(username) = ANY($2) OR lower(email) = ANY($2) OR employee_id IN (
               SELECT e.id FROM employees e JOIN companies c ON c.id = e.company_id WHERE e.employee_code = $3 AND lower(c.code) = lower($4)))`,
            [u[1], [l.admin, l.hr, l.manager].map((x) => x.toLowerCase()), DEMO_EMPLOYEE_ID, config.demoCompanyCode],
          );
          if (hit) return deny(res, 'The shared demo sign-ins cannot be changed.');
        }
        const e = p.match(/^\/api\/employees\/([0-9a-f-]{36})(\/reset-password)?$/i);
        if (e) {
          const hit = await this.db.maybeOne(
            `SELECT 1 FROM employees e JOIN companies c ON c.id = e.company_id WHERE e.id = $1 AND e.employee_code = $2 AND lower(c.code) = lower($3)`,
            [e[1], DEMO_EMPLOYEE_ID, config.demoCompanyCode],
          );
          if (hit) return deny(res, `Employee ${DEMO_EMPLOYEE_ID} is the shared demo sign-in for the staff app and cannot be changed.`);
        }
      } catch (err) {
        return next(err);
      }
      next();
    };
  }
}

@ApiTags('Public')
@Controller('public/demo')
export class DemoController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Whether this server is the public demo, and the shared demo sign-ins.' })
  info() {
    if (!config.demoMode) return { enabled: false };
    const l = demoLogins();
    return {
      enabled: true,
      companyCode: config.demoCompanyCode,
      adminLogin: l.admin,
      hrLogin: l.hr,
      managerLogin: l.manager,
      employeeId: DEMO_EMPLOYEE_ID,
      password: config.demoPassword,
      resetHour: config.demoResetHour,
      mainSiteUrl: config.mainSiteUrl,
    };
  }
}

@Module({ imports: [PayrollModule], controllers: [DemoController], providers: [DemoService], exports: [DemoService] })
export class DemoModule {}
