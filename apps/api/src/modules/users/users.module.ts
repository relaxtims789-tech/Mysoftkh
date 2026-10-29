import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, IsNotEmpty, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import { Db } from '../../database/db.service';
import { AuthUser, clientIp, CurrentUser, requireCompany, Roles } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound, rethrowUnique } from '../../common/errors';
import { normalizePhone } from '../../common/phone';
import { hashPassword, tempPassword } from '../../common/crypto';
import { AuditService, diff } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';

const STAFF = ['company_admin', 'hr', 'manager'] as const;

const PHONE_INPUT = /^[+\d\s().-]{6,24}$/;

class UserDto {
  @ApiProperty({ example: 'Srey Mom' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiPropertyOptional({ example: 'hr@camdemo.com', description: 'Email or phone (or both) - either one signs in' })
  @IsOptional() @IsEmail({}, { message: 'Email is not valid.' }) @MaxLength(160) email?: string;
  @ApiPropertyOptional({ example: '012 345 678' }) @IsOptional() @Matches(PHONE_INPUT, { message: 'Phone number is not valid.' }) phone?: string;
  @ApiProperty({ enum: STAFF }) @IsIn(STAFF as unknown as string[]) role: string;
  @ApiPropertyOptional({ description: 'Departments a manager may see' }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) departmentIds?: string[];
  @ApiPropertyOptional({ description: 'Link to an employee record (their existing log-in becomes this staff account)' }) @IsOptional() @IsUUID() employeeId?: string | null;
}

class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ description: 'Empty string removes it' }) @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail({}, { message: 'Email is not valid.' }) @MaxLength(160) email?: string;
  @ApiPropertyOptional({ description: 'Empty string removes it' }) @IsOptional() @ValidateIf((_, v) => v !== '') @Matches(PHONE_INPUT, { message: 'Phone number is not valid.' }) phone?: string;
  @ApiPropertyOptional({ enum: [...STAFF, 'employee'] }) @IsOptional() @IsIn([...STAFF, 'employee']) role?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) departmentIds?: string[];
  @ApiPropertyOptional({ enum: ['active', 'disabled'] }) @IsOptional() @IsIn(['active', 'disabled']) status?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly auth: AuthService) {}

  async list(companyId: string) {
    return this.db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.username, u.role, u.status, u.last_login_at AS "lastLoginAt", u.employee_id AS "employeeId",
              e.employee_code AS "employeeCode",
              coalesce((SELECT array_agg(md.department_id) FROM manager_departments md WHERE md.user_id = u.id), '{}') AS "departmentIds"
         FROM users u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.company_id = $1 AND u.role <> 'employee' ORDER BY u.role, u.name`,
      [companyId],
    );
  }

  private async setDepartments(companyId: string, userId: string, role: string, ids: string[] | undefined) {
    if (ids === undefined && role === 'manager') return;
    await this.db.query('DELETE FROM manager_departments WHERE user_id = $1', [userId]);
    if (role !== 'manager' || !ids?.length) return;
    const valid = await this.db.query('SELECT id FROM departments WHERE company_id = $1 AND id = ANY($2::uuid[])', [companyId, ids]);
    if (valid.length !== new Set(ids).size) throw badRequest('Department not found.', 'BAD_REFERENCE');
    await this.db.query('INSERT INTO manager_departments (user_id, department_id) SELECT $1, unnest($2::uuid[])', [userId, valid.map((v) => v.id)]);
  }

  /**
   * Staff sign in on /admin with email or phone and no company code, so a staff phone number must not belong to
   * another staff account anywhere.
   */
  private async checkPhoneFree(phoneNorm: string | null, exceptUserId?: string) {
    if (!phoneNorm) return;
    const taken = await this.db.maybeOne(
      `SELECT 1 FROM users WHERE phone_norm = $1 AND role <> 'employee' AND ($2::uuid IS NULL OR id <> $2)`,
      [phoneNorm, exceptUserId ?? null],
    );
    if (taken) throw conflict('That phone number is already used by another staff account.', 'DUPLICATE');
  }

  private parsePhone(phone: string | undefined | null): { phone: string | null; phoneNorm: string | null } {
    if (!phone?.trim()) return { phone: null, phoneNorm: null };
    const phoneNorm = normalizePhone(phone);
    if (!phoneNorm) throw badRequest('Phone number is not valid. Example: 012 345 678 or +855 12 345 678.', 'BAD_PHONE');
    return { phone: phone.trim(), phoneNorm };
  }

  async create(companyId: string, dto: UserDto, actor: AuthUser, ip: string) {
    if (dto.role === 'company_admin' && !['company_admin', 'super_admin'].includes(actor.role)) throw forbidden('Only an administrator can create administrators.');
    const email = dto.email?.trim().toLowerCase() || null;
    const { phone, phoneNorm } = this.parsePhone(dto.phone);
    if (!email && !phoneNorm) throw badRequest('Enter an email or a phone number (or both) for signing in.', 'SIGN_IN_REQUIRED');
    await this.checkPhoneFree(phoneNorm);
    const password = tempPassword();
    try {
      let id: string;
      if (dto.employeeId) {
        const existing = await this.db.maybeOne('SELECT u.id, u.role FROM users u JOIN employees e ON e.id = u.employee_id WHERE e.company_id = $1 AND e.id = $2', [companyId, dto.employeeId]);
        if (!existing) throw badRequest('Employee not found.', 'BAD_REFERENCE');
        if (existing.role !== 'employee') throw badRequest('That employee already has a staff account.', 'ALREADY_STAFF');
        await this.db.query(
          `UPDATE users SET role = $2, email = $3, name = $4, phone = coalesce($5, phone), phone_norm = coalesce($6, phone_norm), updated_at = now() WHERE id = $1`,
          [existing.id, dto.role, email, dto.name.trim(), phone, phoneNorm],
        );
        id = existing.id;
      } else {
        const r = await this.db.one(
          `INSERT INTO users (company_id, username, email, phone, phone_norm, name, role, password_hash, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING id`,
          [companyId, email ?? phoneNorm, email, phone, phoneNorm, dto.name.trim(), dto.role, await hashPassword(password)],
        );
        id = r.id;
      }
      await this.setDepartments(companyId, id, dto.role, dto.departmentIds ?? []);
      await this.audit.log({ companyId, userId: actor.id, action: 'create', module: 'users', recordId: id, newValue: { ...dto }, ip });
      return { id, email, phone, signIn: [email, phone].filter(Boolean).join(' or '), temporaryPassword: dto.employeeId ? undefined : password };
    } catch (e) {
      rethrowUnique(e, 'That email (or sign-in name) is already used.');
    }
  }

  async update(companyId: string, id: string, dto: UpdateUserDto, actor: AuthUser, ip: string) {
    const before = (await this.list(companyId)).find((u) => u.id === id);
    if (!before) throw notFound('User');
    if (id === actor.id && (dto.status === 'disabled' || (dto.role && dto.role !== before.role))) throw badRequest('You cannot disable yourself or change your own role.', 'SELF_CHANGE');
    const touchesAdmin = before.role === 'company_admin' || dto.role === 'company_admin';
    if (touchesAdmin && !['company_admin', 'super_admin'].includes(actor.role)) throw forbidden('Only an administrator can change administrators.');
    if (dto.role === 'employee' && !before.employeeId) throw badRequest('Only accounts linked to an employee can become employee accounts.', 'BAD_ROLE');
    const email = dto.email !== undefined ? dto.email.trim().toLowerCase() || null : before.email;
    const ph = dto.phone !== undefined ? this.parsePhone(dto.phone) : { phone: before.phone, phoneNorm: undefined as string | null | undefined };
    if (!email && !(ph.phone)) throw badRequest('Keep an email or a phone number for signing in.', 'SIGN_IN_REQUIRED');
    if (ph.phoneNorm) await this.checkPhoneFree(ph.phoneNorm, id);
    const next = { name: dto.name?.trim() ?? before.name, email, phone: ph.phone, role: dto.role ?? before.role, status: dto.status ?? before.status };
    try {
      await this.db.query(
        `UPDATE users SET name = $3, email = $4, phone = $5, phone_norm = CASE WHEN $6::boolean THEN $7 ELSE phone_norm END, role = $8, status = $9,
                username = CASE WHEN employee_id IS NULL THEN coalesce($4, $7, username) ELSE username END, updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [companyId, id, next.name, next.email, next.phone, dto.phone !== undefined, ph.phoneNorm ?? null, next.role, next.status],
      );
    } catch (e) {
      rethrowUnique(e, 'That email (or sign-in name) is already used.');
    }
    await this.setDepartments(companyId, id, next.role, dto.departmentIds);
    if (next.status === 'disabled') await this.auth.revokeAll(id);
    const d = diff(before, { ...next, departmentIds: dto.departmentIds ?? before.departmentIds });
    await this.audit.log({ companyId, userId: actor.id, action: 'update', module: 'users', recordId: id, oldValue: d.old, newValue: d.new, ip });
    return (await this.list(companyId)).find((u) => u.id === id) ?? { id, ...next };
  }

  async resetPassword(companyId: string, id: string, actor: AuthUser, ip: string) {
    const u = await this.db.maybeOne(`SELECT id, role FROM users WHERE company_id = $1 AND id = $2`, [companyId, id]);
    if (!u) throw notFound('User');
    if (u.role === 'company_admin' && !['company_admin', 'super_admin'].includes(actor.role)) throw forbidden();
    const password = tempPassword();
    await this.db.query('UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1', [id, await hashPassword(password)]);
    await this.auth.revokeAll(id);
    await this.audit.log({ companyId, userId: actor.id, action: 'reset_password', module: 'users', recordId: id, ip });
    return { temporaryPassword: password };
  }
}

const uuid = new ParseUUIDPipe();

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('super_admin', 'company_admin', 'hr')
  @ApiOperation({ summary: 'Staff accounts (admins, HR, managers).' })
  list(@CurrentUser() u: AuthUser) {
    return this.users.list(requireCompany(u));
  }

  @Post()
  @Roles('super_admin', 'company_admin', 'hr')
  create(@Body() dto: UserDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.users.create(requireCompany(u), dto, u, clientIp(req));
  }

  @Put(':id')
  @Roles('super_admin', 'company_admin', 'hr')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateUserDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.users.update(requireCompany(u), id, dto, u, clientIp(req));
  }

  @Post(':id/reset-password')
  @Roles('super_admin', 'company_admin', 'hr')
  resetPassword(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.users.resetPassword(requireCompany(u), id, u, clientIp(req));
  }
}

@Module({ imports: [AuthModule], controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
