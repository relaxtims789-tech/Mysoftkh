import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Db } from '../../database/db.service';
import { AuthUser, requireEmployee } from '../../common/auth';
import { AppError, badRequest, forbidden, notFound } from '../../common/errors';
import { isP256Jwk, verifyDeviceSignature } from '../../common/crypto';
import { escapeLike, pageParams, scopeEmployees, Where } from '../../common/sql';
import { checkGeofence, isValidCoordinate, travelSpeedKmh } from '../../domain/geo';
import { isWorkingDay } from '../../domain/daily-summary';
import {
  AttendanceType, evaluatePunch, isEarlyCheckout, resolveScanType, TodayPunch, TYPE_LABELS, validateScanType,
} from '../../domain/punch-rules';
import { addDays, daysBetween, localParts, minutesToTime, timeToMinutes } from '../../domain/time';
import { AuditService } from '../audit/audit.service';
import { CompanyContextService } from '../core/company-context.service';
import { TelegramService } from '../core/telegram.service';
import { adminMessages, LIVE, REVIEW, tgMessages, groupMessages, LIVE_LINK } from '../core/telegram-messages';
import { ChallengeService, scanMessage } from '../devices/challenge.service';
import { DEVICE_MESSAGES, DevicesService } from '../devices/devices.service';
import { extractQrToken } from '../qr/qr.service';
import { HistoryQuery, LiveQuery, PunchDto, RecordsQuery, ScanDto } from './attendance.dto';
import { AttendanceSummaryService, countStatuses } from './summary.service';

/** Scans faster than this between two places are recorded as suspicious (likely a faked location). */
const SUSPICIOUS_SPEED_KMH = 200;

/** Stands in for the QR token in the signed message of a button check-in (the phone signs the same text). */
export const BUTTON_TOKEN = 'BUTTON';

export interface ScanMeta {
  ip: string;
  userAgent: string;
}

export function mapRecord(r: any, tz?: string) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code ?? undefined,
    employeeName: r.employee_name ?? undefined,
    branchId: r.branch_id,
    branchName: r.branch_name ?? undefined,
    qrCodeId: r.qr_code_id,
    type: r.attendance_type as AttendanceType,
    typeLabel: TYPE_LABELS[r.attendance_type as AttendanceType],
    scanTime: r.scan_time,
    localTime: tz ? localParts(new Date(r.scan_time), tz).time : undefined,
    workDate: r.work_date,
    latitude: r.latitude,
    longitude: r.longitude,
    gpsAccuracy: r.gps_accuracy,
    distanceFromBranch: r.distance_from_branch,
    deviceId: r.device_id,
    source: r.source,
    status: r.status,
    lateMinutes: r.late_minutes,
    earlyMinutes: r.early_minutes,
    overtimeMinutes: r.overtime_minutes,
    remarks: r.remarks,
    isVoid: r.is_void,
    voidReason: r.void_reason,
    createdAt: r.created_at,
  };
}

const STATUS_MESSAGES: Record<string, string> = {
  on_time: 'ON TIME',
  late: 'LATE',
  early_leave: 'EARLY LEAVE',
  overtime: 'OVERTIME',
  off_day: 'DAY OFF',
};

/** Refused scans the admin bot reports: someone in the wrong place, with the wrong phone or the wrong QR. */
const REFUSALS_TO_REPORT = new Set(['OUTSIDE_GEOFENCE', 'DEVICE_NOT_REGISTERED', 'DEVICE_NOT_ALLOWED', 'BAD_DEVICE_SIGNATURE', 'WRONG_BRANCH', 'QR_DISABLED', 'INVALID_QR']);

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger('Attendance');

  constructor(
    private readonly db: Db,
    private readonly ctx: CompanyContextService,
    private readonly devices: DevicesService,
    private readonly challenges: ChallengeService,
    private readonly summaries: AttendanceSummaryService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * QR scan. Order: QR -> branch -> GPS -> geofence -> employee -> device -> rules -> record.
   * Any failed check throws and is logged to attendance_attempts; nothing is written to attendance.
   */
  async scan(user: AuthUser, dto: ScanDto, meta: ScanMeta, forcedType?: AttendanceType) {
    return this.pipeline(user, dto, meta, forcedType, 'qr');
  }

  /**
   * Check-in / check-out button (no QR), when the company allows it. Same checks as a scan, except that the branch is
   * the nearest active branch whose area the phone is inside (only the home branch when that rule is on).
   */
  async punch(user: AuthUser, dto: PunchDto, meta: ScanMeta) {
    return this.pipeline(user, { ...dto, qrToken: BUTTON_TOKEN }, meta, dto.type, 'button');
  }

  private async pipeline(user: AuthUser, dto: ScanDto, meta: ScanMeta, forcedType: AttendanceType | undefined, mode: 'qr' | 'button') {
    const employeeId = requireEmployee(user);
    const companyId = user.companyId!;
    const lat = dto.latitude ?? null;
    const lng = dto.longitude ?? null;
    const acc = dto.accuracy ?? null;
    const requested = forcedType ?? dto.type ?? null;
    const attempt: Record<string, any> = { companyId, employeeId, type: requested, lat, lng, acc, deviceIdentifier: dto.device?.id ?? null, ...meta };

    const fail = async (status: number, code: string, message: string, details?: Record<string, unknown>): Promise<never> => {
      await this.logAttempt({ ...attempt, code, message }).catch((e) => this.logger.error(`attempt log failed: ${e.message}`));
      this.alertRefused(companyId, employeeId, code, message, details).catch(() => undefined);
      throw new AppError(status, code, message, details);
    };

    if (forcedType && dto.type && dto.type !== forcedType) await fail(400, 'TYPE_MISMATCH', 'The scan type does not match this action.');

    const company = await this.ctx.get(companyId);
    const rules = company.rules;
    const emp = await this.db.maybeOne(
      `SELECT e.id, e.status, e.branch_id, e.schedule_id, e.name, b.name AS home_branch FROM employees e LEFT JOIN branches b ON b.id = e.branch_id
        WHERE e.id = $1 AND e.company_id = $2`,
      [employeeId, companyId],
    );
    const hasCoords = isValidCoordinate(lat, lng);
    const checkGpsQuality = async () => {
      if (!rules.requireGps) return;
      if (!hasCoords) await fail(400, 'GPS_REQUIRED', 'Your location is needed to record attendance. Turn on location and allow access, then try again.');
      if (acc === null || acc > rules.maxGpsAccuracy) {
        await fail(400, 'GPS_INACCURATE', `Your GPS signal is too weak${acc !== null ? ` (±${Math.round(acc)} m)` : ''}. Move near a window or outside and try again.`, { accuracy: acc, maxAccuracy: rules.maxGpsAccuracy });
      }
    };

    // 1 + 2. Where: the scanned QR's branch, or (button) the branch the phone is in.
    let site!: { branch_id: string | null; branch_name: string | null; qr_id: string | null; latitude: number | null; longitude: number | null; radius: number | null };
    let distance: number | null = null;
    if (mode === 'qr') {
      const token = extractQrToken(dto.qrToken);
      if (!token) await fail(400, 'INVALID_QR', 'This is not an attendance QR code.');
      const qr = await this.db.maybeOne(
        `SELECT q.id, q.company_id, q.status, q.branch_id, b.name AS branch_name, b.status AS branch_status, b.latitude, b.longitude, b.radius
           FROM qr_codes q JOIN branches b ON b.id = q.branch_id WHERE q.token = $1`,
        [token],
      );
      if (!qr || qr.company_id !== companyId) await fail(400, 'INVALID_QR', 'This QR code is not valid for your company.');
      attempt.qrCodeId = qr.id;
      attempt.branchId = qr.branch_id;
      if (qr.status !== 'active') await fail(400, 'QR_DISABLED', 'This QR code has been disabled. Please scan the current QR code at the entrance.');
      if (qr.branch_status !== 'active') await fail(400, 'BRANCH_INACTIVE', `${qr.branch_name} is not accepting attendance.`);
      if (rules.restrictToHomeBranch && emp?.branch_id && emp.branch_id !== qr.branch_id) {
        await fail(403, 'WRONG_BRANCH', `You can only scan at your branch (${emp.home_branch}).`);
      }
      site = { branch_id: qr.branch_id, branch_name: qr.branch_name, qr_id: qr.id, latitude: qr.latitude, longitude: qr.longitude, radius: qr.radius ?? rules.geofenceRadius };

      // 3 + 4. GPS and geofence
      await checkGpsQuality();
      if (hasCoords) {
        const g = checkGeofence({ latitude: lat!, longitude: lng! }, { latitude: site.latitude!, longitude: site.longitude! }, site.radius!);
        distance = g.distance;
        attempt.distance = distance;
        if (rules.requireGps && !g.inside) {
          await fail(403, 'OUTSIDE_GEOFENCE', 'Your location is outside the allowed attendance area.', { distance: Math.round(g.distance), radius: site.radius });
        }
      }
    } else {
      if (!rules.allowButtonCheckin) await fail(403, 'BUTTON_CHECKIN_DISABLED', 'Check-in without scanning is turned off by your company. Please scan the QR code at the entrance.');
      await checkGpsQuality();
      const branches = await this.db.query(
        `SELECT id, name, latitude, longitude, coalesce(radius, $2) AS radius FROM branches
          WHERE company_id = $1 AND status = 'active' AND ($3::uuid IS NULL OR id = $3)`,
        [companyId, rules.geofenceRadius, rules.restrictToHomeBranch && emp?.branch_id ? emp.branch_id : null],
      );
      const ranked = hasCoords
        ? branches
            .map((b) => ({ b, g: checkGeofence({ latitude: lat!, longitude: lng! }, b, b.radius) }))
            .sort((x, y) => (x.g.inside === y.g.inside ? x.g.distance - y.g.distance : x.g.inside ? -1 : 1))
        : [];
      const best = ranked[0];
      if (best?.g.inside || (!rules.requireGps && best)) {
        site = { branch_id: best.b.id, branch_name: best.b.name, qr_id: null, latitude: best.b.latitude, longitude: best.b.longitude, radius: best.b.radius };
        distance = best.g.distance;
      } else if (rules.requireGps) {
        attempt.branchId = best?.b.id ?? null;
        attempt.distance = best?.g.distance ?? null;
        await fail(403, 'OUTSIDE_GEOFENCE', 'Your location is outside the allowed attendance area.',
          best ? { distance: Math.round(best.g.distance), radius: best.b.radius, branch: best.b.name } : undefined);
      } else {
        // GPS not required and no location: record against the employee's own branch.
        site = { branch_id: emp?.branch_id ?? null, branch_name: emp?.home_branch ?? null, qr_id: null, latitude: null, longitude: null, radius: null };
      }
      attempt.branchId = site!.branch_id;
      attempt.distance = distance;
    }

    // 5. Validate employee
    if (!emp || emp.status !== 'active') await fail(403, 'EMPLOYEE_INACTIVE', 'Your employee record is inactive. Contact HR.');

    // 6. Validate device
    let deviceId: string | null = null;
    const device = dto.device ? await this.devices.findForScan(employeeId, dto.device.id) : null;
    if (rules.requireDeviceBinding) {
      if (!dto.device) await fail(403, 'DEVICE_REQUIRED', 'This phone is not registered for attendance.');
      if (!device) await fail(403, 'DEVICE_NOT_REGISTERED', 'This phone is not registered for attendance. Register it from your profile, or use your registered phone.');
      if (device.status === 'pending') await fail(403, 'DEVICE_PENDING', DEVICE_MESSAGES.pending);
      if (device.status !== 'active') await fail(403, 'DEVICE_NOT_ALLOWED', DEVICE_MESSAGES[device.status] ?? 'This phone is not allowed.');
    }
    if (dto.device && device?.status === 'active') {
      try {
        await this.challenges.consume(user.id, dto.device.challenge);
      } catch (e) {
        await fail(400, 'BAD_CHALLENGE', (e as AppError).message);
      }
      const message = scanMessage({ challenge: dto.device.challenge, qrToken: dto.qrToken, type: dto.type, latitude: dto.latitude, longitude: dto.longitude, accuracy: dto.accuracy });
      if (!isP256Jwk(device.public_key) || !verifyDeviceSignature(device.public_key, message, dto.device.signature)) {
        await fail(403, 'BAD_DEVICE_SIGNATURE', 'Device verification failed. Please try again from your registered phone.');
      }
      deviceId = device.id;
    }

    // 7 + 8. Rules and record, serialised per employee so two quick scans cannot both pass the duplicate check.
    let pendingFailure = null as { status: number; code: string; message: string; details?: Record<string, unknown> } | null;
    const result = await this.db.tx(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`scan:${employeeId}`]);
      const now = new Date();
      const local = localParts(now, company.timezone);
      const fmt = (d: Date) => localParts(new Date(d), company.timezone).time;

      const last = await tx.maybeOne(
        `SELECT a.id, a.attendance_type, a.scan_time, a.latitude, a.longitude FROM attendance a
          WHERE a.employee_id = $1 AND NOT a.is_void ORDER BY a.scan_time DESC LIMIT 1`,
        [employeeId],
      );
      if (last && rules.minScanIntervalSeconds > 0 && now.getTime() - new Date(last.scan_time).getTime() < rules.minScanIntervalSeconds * 1000) {
        pendingFailure = {
          status: HttpStatus.CONFLICT, code: 'DUPLICATE_SCAN', message: 'Attendance already recorded.',
          details: { type: last.attendance_type, typeLabel: TYPE_LABELS[last.attendance_type as AttendanceType], time: fmt(last.scan_time) },
        };
        return null;
      }

      const todayRows = await tx.query(
        `SELECT attendance_type, scan_time FROM attendance WHERE employee_id = $1 AND work_date = $2 AND NOT is_void ORDER BY scan_time`,
        [employeeId, local.date],
      );
      const today: TodayPunch[] = todayRows.map((r) => ({ type: r.attendance_type, time: new Date(r.scan_time), minutes: localParts(new Date(r.scan_time), company.timezone).minutes }));
      const schedule = await this.ctx.scheduleFor(companyId, emp.schedule_id, tx);
      const holiday = await this.ctx.holidayName(companyId, local.date, tx);
      const working = isWorkingDay({ schedule, weekday: local.weekday, holiday });
      const type = requested ?? resolveScanType(today, local.minutes, schedule, rules);

      const violation = validateScanType(type, today, rules, fmt);
      if (violation) {
        pendingFailure = { status: HttpStatus.CONFLICT, code: violation.code, message: violation.message };
        return null;
      }
      if (type === 'check_out' && !dto.confirmEarly && isEarlyCheckout(local.minutes, schedule, working)) {
        pendingFailure = {
          status: HttpStatus.CONFLICT, code: 'CONFIRM_EARLY_CHECKOUT',
          message: `Your work ends at ${minutesToTime(timeToMinutes(schedule!.endTime))}. Check out now?`,
          details: { type, endTime: schedule!.endTime.slice(0, 5), now: local.time },
        };
        return null;
      }

      const ev = evaluatePunch(type, local.minutes, schedule, rules, working);
      const remarks: string[] = [];
      if (mode === 'button') remarks.push('Check-in button (no QR)');
      if (emp.branch_id && site.branch_id && emp.branch_id !== site.branch_id) remarks.push(`At ${site.branch_name}; home branch ${emp.home_branch}`);
      if (holiday) remarks.push(`Holiday: ${holiday}`);
      if (hasCoords && last?.latitude != null && last?.longitude != null) {
        const speed = travelSpeedKmh(
          { latitude: last.latitude, longitude: last.longitude, time: new Date(last.scan_time) },
          { latitude: lat!, longitude: lng!, time: now },
        );
        if (speed > SUSPICIOUS_SPEED_KMH) remarks.push(`Suspicious: ${Math.round(speed)} km/h since previous scan`);
      }

      const rec = await tx.one(
        `INSERT INTO attendance (company_id, employee_id, branch_id, qr_code_id, attendance_type, scan_time, work_date, latitude, longitude, gps_accuracy,
                                 distance_from_branch, device_id, source, status, late_minutes, early_minutes, overtime_minutes, remarks, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
        [companyId, employeeId, site.branch_id, site.qr_id, type, now, local.date, hasCoords ? lat : null, hasCoords ? lng : null, acc, distance, deviceId,
          mode === 'qr' ? 'qr' : 'button', ev.status, ev.lateMinutes, ev.earlyMinutes, ev.overtimeMinutes, remarks.join('; ') || null, user.id],
      );
      if (deviceId) await tx.query('UPDATE devices SET last_used_at = now() WHERE id = $1', [deviceId]);
      return { rec, local, type, ev };
    });

    if (!result) {
      const f = pendingFailure!;
      if (f.code === 'CONFIRM_EARLY_CHECKOUT') throw new AppError(f.status, f.code, f.message, f.details);
      return fail(f.status, f.code, f.message, f.details);
    }

    const { rec, local, type, ev } = result;
    this.alertAfterPunch(companyId, employeeId, type, local, ev, site.branch_name ?? '').catch(() => undefined);
    if (type === 'check_in' || type === 'check_out') this.groupAfterPunch(companyId, employeeId, type, local.time, site.branch_id ?? null, site.branch_name ?? '', ev).catch(() => undefined);
    this.telegram.notifyEmployee(employeeId, tgMessages.punch({
      type, time: local.time, branch: site.branch_name ?? '', status: ev.status, lateMinutes: ev.lateMinutes, earlyMinutes: ev.earlyMinutes, overtimeMinutes: ev.overtimeMinutes,
    }));
    const today = await this.today(user);
    return {
      ok: true,
      type,
      typeLabel: TYPE_LABELS[type],
      status: ev.status,
      statusLabel: STATUS_MESSAGES[ev.status],
      message: `${TYPE_LABELS[type]} recorded at ${local.time}`,
      time: local.time,
      date: local.date,
      branchName: site.branch_name,
      distance: distance === null ? null : Math.round(distance),
      lateMinutes: ev.lateMinutes,
      earlyMinutes: ev.earlyMinutes,
      overtimeMinutes: ev.overtimeMinutes,
      record: mapRecord(rec, company.timezone),
      today,
    };
  }

  /** The company's Telegram groups: who checked in or out, where and when. */
  private async groupAfterPunch(companyId: string, employeeId: string, type: 'check_in' | 'check_out', time: string, branchId: string | null, branch: string,
    ev: { status: string; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number }) {
    const emp = await this.db.one('SELECT name, employee_code FROM employees WHERE id = $1', [employeeId]);
    this.telegram.notifyGroups(companyId, type, branchId, groupMessages.punch({
      name: emp.name, code: emp.employee_code, type, time, branch, status: ev.status, lateMinutes: ev.lateMinutes, earlyMinutes: ev.earlyMinutes, overtimeMinutes: ev.overtimeMinutes,
    }), LIVE_LINK);
  }

  /** Admin bot: late check-in, and overtime that waits for approval. */
  private async alertAfterPunch(companyId: string, employeeId: string, type: AttendanceType, local: { date: string; time: string }, ev: { status: string; lateMinutes: number; overtimeMinutes: number }, branch: string) {
    const late = type === 'check_in' && ev.status === 'late';
    const ot = type === 'check_out' && ev.overtimeMinutes > 0;
    if (!late && !ot) return;
    const emp = await this.db.one('SELECT name, employee_code, department_id FROM employees WHERE id = $1', [employeeId]);
    if (late) this.telegram.alertAdmins(companyId, 'late_absent', emp.department_id, adminMessages.late(emp.name, emp.employee_code, local.time, ev.lateMinutes, branch), [LIVE]);
    if (ot) {
      const policy = await this.db.maybeOne('SELECT requires_approval FROM overtime_policies WHERE company_id = $1', [companyId]);
      if (policy?.requires_approval) this.telegram.alertAdmins(companyId, 'requests', emp.department_id, adminMessages.newOvertime(emp.name, emp.employee_code, local.date, ev.overtimeMinutes), [REVIEW]);
    }
  }

  /** Refused scans worth a look (wrong place, wrong phone, wrong QR); at most one per person and problem every 15 minutes. */
  private refusedSent = new Map<string, number>();
  private async alertRefused(companyId: string, employeeId: string, code: string, message: string, details?: Record<string, unknown>) {
    if (!REFUSALS_TO_REPORT.has(code)) return;
    const key = `${employeeId}|${code}`;
    if (Date.now() - (this.refusedSent.get(key) ?? 0) < 15 * 60_000) return;
    this.refusedSent.set(key, Date.now());
    if (this.refusedSent.size > 5000) this.refusedSent.clear();
    const emp = await this.db.one('SELECT name, employee_code, department_id FROM employees WHERE id = $1', [employeeId]);
    const d = details as { distance?: number; branch?: string; radius?: number } | undefined;
    const detail = d?.distance !== undefined ? `${d.distance} m from ${d.branch ?? 'the branch'} (allowed ${d.radius} m)` : null;
    this.telegram.alertAdmins(companyId, 'rejected', emp.department_id, adminMessages.rejectedScan(emp.name, emp.employee_code, message, detail), [LIVE]);
  }

  private async logAttempt(a: Record<string, any>) {
    await this.db.query(
      `INSERT INTO attendance_attempts (company_id, employee_id, branch_id, qr_code_id, attendance_type, reason_code, message, latitude, longitude,
                                        gps_accuracy, distance_from_branch, device_identifier, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [a.companyId, a.employeeId, a.branchId ?? null, a.qrCodeId ?? null, a.type, a.code, a.message,
        typeof a.lat === 'number' && Number.isFinite(a.lat) ? a.lat : null, typeof a.lng === 'number' && Number.isFinite(a.lng) ? a.lng : null,
        typeof a.acc === 'number' && Number.isFinite(a.acc) ? a.acc : null, a.distance ?? null, a.deviceIdentifier, a.ip, String(a.userAgent || '').slice(0, 300)],
    );
  }

  /** Employee home screen: today's scans, summary and what the next scan will be. */
  async today(user: AuthUser) {
    const employeeId = requireEmployee(user);
    const companyId = user.companyId!;
    const company = await this.ctx.get(companyId);
    const now = this.ctx.now(company.timezone);
    const built = await this.summaries.build(companyId, now.date, now.date, null, { employeeIds: [employeeId], includeInactive: true });
    const emp = built.employees[0];
    const summary = built.days.get(employeeId)?.[0] ?? null;
    const punches = built.punches.get(employeeId)?.get(now.date) ?? [];
    const schedule = emp ? (emp.scheduleId && built.schedules.get(emp.scheduleId)) || built.schedules.get('') || null : null;
    const nextType = resolveScanType(punches.map((p) => ({ type: p.type, minutes: p.minutes, time: p.time })), now.minutes, schedule, company.rules);
    return {
      date: now.date,
      time: now.time,
      timezone: company.timezone,
      schedule: schedule
        ? { startTime: schedule.startTime.slice(0, 5), endTime: schedule.endTime.slice(0, 5), lunchStart: schedule.lunchStart?.slice(0, 5) ?? null, lunchEnd: schedule.lunchEnd?.slice(0, 5) ?? null, lateAfter: minutesToTime(timeToMinutes(schedule.startTime) + schedule.lateAfterMinutes), workDays: schedule.workDays }
        : null,
      summary,
      records: punches.map((p) => ({
        id: p.id, type: p.type, typeLabel: TYPE_LABELS[p.type], time: localParts(new Date(p.time), company.timezone).time, scanTime: p.time,
        status: p.status, lateMinutes: p.lateMinutes, earlyMinutes: p.earlyMinutes, overtimeMinutes: p.overtimeMinutes, branchName: p.branchName,
        distance: p.distance, source: p.source,
      })),
      nextType,
      nextTypeLabel: TYPE_LABELS[nextType],
      rules: { allowLunchScan: company.rules.allowLunchScan, requireGps: company.rules.requireGps, requireDeviceBinding: company.rules.requireDeviceBinding, allowEmployeeCorrections: company.rules.allowEmployeeCorrections, allowButtonCheckin: company.rules.allowButtonCheckin },
    };
  }

  /** Day-by-day history for the employee (or, for staff, any employee they may see). */
  async history(user: AuthUser, q: HistoryQuery) {
    const companyId = user.companyId!;
    let employeeId = user.employeeId;
    if (q.employeeId && q.employeeId !== user.employeeId) {
      if (user.role === 'employee') throw forbidden();
      employeeId = q.employeeId;
    }
    if (!employeeId) throw forbidden('This account is not linked to an employee.', 'NOT_AN_EMPLOYEE');
    const company = await this.ctx.get(companyId);
    const now = this.ctx.now(company.timezone);
    const to = q.to && q.to < now.date ? q.to : now.date;
    const from = q.from ?? addDays(to, -30);
    if (from > to) throw badRequest('"From" must be before "to".', 'BAD_RANGE');
    if (daysBetween(from, to) > 400) throw badRequest('Choose a range of at most 400 days.', 'BAD_RANGE');
    const built = await this.summaries.build(companyId, from, to, user.role === 'employee' ? null : user, { employeeIds: [employeeId], includeInactive: true });
    const emp = built.employees[0];
    if (!emp) throw notFound('Employee');
    const days = (built.days.get(employeeId) ?? []).slice().reverse();
    const byDate = built.punches.get(employeeId) ?? new Map();
    const totals = { ...countStatuses(days), lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0, workedMinutes: 0 };
    for (const d of days) {
      totals.lateMinutes += d.lateMinutes;
      totals.earlyMinutes += d.earlyMinutes;
      totals.overtimeMinutes += d.overtimeMinutes;
      totals.workedMinutes += d.workedMinutes;
    }
    return {
      employee: emp,
      from,
      to,
      totals,
      days: days.map((d) => ({
        ...d,
        records: (byDate.get(d.date) ?? []).map((p: any) => ({
          id: p.id, type: p.type, typeLabel: TYPE_LABELS[p.type as AttendanceType], time: localParts(new Date(p.time), company.timezone).time,
          status: p.status, branchName: p.branchName, distance: p.distance, source: p.source,
        })),
      })),
    };
  }

  /** Admin live view: one row per employee for a date. */
  async live(user: AuthUser, q: LiveQuery) {
    const companyId = user.companyId!;
    const company = await this.ctx.get(companyId);
    const date = q.date ?? this.ctx.now(company.timezone).date;
    const built = await this.summaries.build(companyId, date, date, user, { departmentId: q.departmentId, branchId: q.branchId, search: q.search });
    const rows = built.employees
      .map((e) => {
        const s = built.days.get(e.id)?.[0];
        if (!s) return null;
        const punches = built.punches.get(e.id)?.get(date) ?? [];
        const first = punches.find((p) => p.type === 'check_in') ?? punches[0];
        const lastPunch = punches[punches.length - 1];
        const t = (d: Date | null) => (d ? localParts(new Date(d), company.timezone).time : null);
        return {
          employeeId: e.id, employeeCode: e.employeeCode, name: e.name, photo: e.profilePhoto, department: e.department, branch: e.branch,
          checkIn: t(s.checkIn), lunchOut: t(s.lunchOut), lunchIn: t(s.lunchIn), checkOut: t(s.checkOut),
          status: s.status, flags: s.flags, lateMinutes: s.lateMinutes, earlyMinutes: s.earlyMinutes, overtimeMinutes: s.overtimeMinutes, workedMinutes: s.workedMinutes,
          location: first ? { branch: first.branchName, distance: first.distance, latitude: first.latitude, longitude: first.longitude, source: first.source } : null,
          lastScanAt: lastPunch?.time ?? null,
          leaveType: s.leaveType,
          holiday: s.holiday,
        };
      })
      .filter(<T>(r: T | null): r is T => !!r);
    const counts = countStatuses(rows.map((r) => built.days.get(r.employeeId)![0]));
    const filtered = rows.filter((r) => {
      switch (q.status ?? 'all') {
        case 'all': return true;
        case 'present': return r.status === 'present' || r.status === 'late';
        case 'checked_out': return !!r.checkOut;
        case 'overtime': return r.overtimeMinutes > 0;
        case 'early_leave': return r.flags.includes('early_leave');
        default: return r.status === q.status;
      }
    });
    return { date, counts, rows: filtered };
  }

  /** Raw attendance records (all sources). */
  async records(user: AuthUser, q: RecordsQuery) {
    const companyId = user.companyId!;
    const company = await this.ctx.get(companyId);
    const today = this.ctx.now(company.timezone).date;
    const w = new Where().add('a.company_id = ?', companyId);
    scopeEmployees(w, user);
    w.add('a.work_date >= ?', q.from ?? addDays(today, -7)).add('a.work_date <= ?', q.to ?? today);
    w.addIf(q.employeeId, 'a.employee_id = ?');
    w.addIf(q.branchId, 'a.branch_id = ?');
    w.addIf(q.source, 'a.source = ?');
    const { limit, offset, page, pageSize } = pageParams(q, 500);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM attendance a JOIN employees e ON e.id = a.employee_id ${w}`, w.params)).n;
    const rows = await this.db.query(
      `SELECT a.*, e.employee_code, e.name AS employee_name, b.name AS branch_name
         FROM attendance a JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id
         ${w} ORDER BY a.scan_time DESC LIMIT ${limit} OFFSET ${offset}`,
      w.params,
    );
    return { items: rows.map((r) => mapRecord(r, company.timezone)), total, page, pageSize };
  }

  /** Rejected scans, for security review. */
  async attempts(user: AuthUser, q: { from?: string; to?: string; reason?: string; page?: number; pageSize?: number }) {
    const companyId = user.companyId!;
    const w = new Where().add('t.company_id = ?', companyId);
    scopeEmployees(w, user);
    if (q.from) w.add('t.created_at >= ?::date', q.from);
    if (q.to) w.add(`t.created_at < (?::date + interval '1 day')`, q.to);
    w.addIf(q.reason, 't.reason_code = ?');
    const { limit, offset, page, pageSize } = pageParams(q, 500);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM attendance_attempts t LEFT JOIN employees e ON e.id = t.employee_id ${w}`, w.params)).n;
    const rows = await this.db.query(
      `SELECT t.id, t.created_at AS "createdAt", t.reason_code AS "reasonCode", t.message, t.attendance_type AS type,
              t.latitude, t.longitude, t.gps_accuracy AS "gpsAccuracy", t.distance_from_branch AS distance, t.ip_address AS ip,
              e.employee_code AS "employeeCode", e.name AS "employeeName", b.name AS "branchName"
         FROM attendance_attempts t LEFT JOIN employees e ON e.id = t.employee_id LEFT JOIN branches b ON b.id = t.branch_id
         ${w} ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      w.params,
    );
    return { items: rows, total, page, pageSize };
  }

  async getRecord(user: AuthUser, id: string) {
    const companyId = user.companyId!;
    const company = await this.ctx.get(companyId);
    const w = new Where().add('a.company_id = ?', companyId).add('a.id = ?', id);
    if (user.role === 'employee') w.add('a.employee_id = ?', user.employeeId);
    else scopeEmployees(w, user);
    const r = await this.db.maybeOne(
      `SELECT a.*, e.employee_code, e.name AS employee_name, b.name AS branch_name
         FROM attendance a JOIN employees e ON e.id = a.employee_id LEFT JOIN branches b ON b.id = a.branch_id ${w}`,
      w.params,
    );
    if (!r) throw notFound('Attendance record');
    return mapRecord(r, company.timezone);
  }

  async voidRecord(user: AuthUser, id: string, reason: string, ip: string) {
    const companyId = user.companyId!;
    return this.db.tx(async (tx) => {
      const r = await tx.maybeOne('SELECT * FROM attendance WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, id]);
      if (!r) throw notFound('Attendance record');
      if (r.is_void) throw badRequest('This record is already void.', 'ALREADY_VOID');
      await tx.query('UPDATE attendance SET is_void = true, void_reason = $2, voided_by = $3, voided_at = now() WHERE id = $1', [id, reason.trim(), user.id]);
      await this.audit.log({ companyId, userId: user.id, action: 'void', module: 'attendance', recordId: id, oldValue: mapRecord(r), newValue: { isVoid: true, reason }, ip }, tx);
      return { ok: true };
    });
  }
}
