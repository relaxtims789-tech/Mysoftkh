import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { config } from '../../config';
import { ADMIN_ROLES, AuthUser, clientIp, CurrentUser, requireCompany, Roles, STAFF_ROLES } from '../../common/auth';
import { ChallengeService } from './challenge.service';
import { DevicesService } from './devices.service';

const uuid = new ParseUUIDPipe();

/**
 * One device cookie per employee (a shared test phone may hold several). httpOnly, so page scripts cannot read it;
 * 400 days is the longest browsers keep a cookie, and it is renewed whenever it is replaced.
 */
function deviceCookieName(u: AuthUser) {
  return `qra_dev_${(u.employeeId ?? '').replace(/-/g, '').slice(0, 12)}`;
}
function readDeviceCookie(req: Request, u: AuthUser): string | undefined {
  const v = req.cookies?.[deviceCookieName(u)];
  return typeof v === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : undefined;
}
function setDeviceCookie(res: Response, u: AuthUser, token: string) {
  res.cookie(deviceCookieName(u), token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/api', maxAge: 400 * 86400 * 1000 });
}

class RegisterDeviceDto {
  @ApiProperty({ description: 'Public P-256 key (JWK) created and kept non-extractable in the phone browser' }) @IsObject() publicKey: Record<string, unknown>;
  @ApiPropertyOptional({ example: 'Dara\'s iPhone' }) @IsOptional() @IsString() @MaxLength(80) deviceName?: string;
  @ApiPropertyOptional({ example: 'iOS' }) @IsOptional() @IsString() @MaxLength(40) platform?: string;
  @ApiProperty({ description: 'From GET /api/attendance/challenge' }) @IsString() @MaxLength(200) challenge: string;
  @ApiProperty({ description: 'ECDSA P-256 SHA-256 signature (raw r||s, base64url) of "QRA-REGISTER|<challenge>"' })
  @IsString() @Matches(/^[A-Za-z0-9_-]{86}$/, { message: 'Invalid signature.' }) signature: string;
}

@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService, private readonly challenges: ChallengeService) {}

  @Post('register')
  @Roles('employee', 'manager', 'hr', 'company_admin')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register this phone for attendance (device binding).' })
  async register(@Body() dto: RegisterDeviceDto, @CurrentUser() u: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { deviceToken, ...result } = await this.devices.register(u, dto, {
      ip: clientIp(req), userAgent: String(req.headers['user-agent'] || ''), deviceToken: readDeviceCookie(req, u),
    });
    if (deviceToken) setDeviceCookie(res, u, deviceToken);
    return result;
  }

  @Get('me')
  @ApiOperation({ summary: 'My registered phones.' })
  mine(@CurrentUser() u: AuthUser, @Query('current') current?: string) {
    return this.devices.mine(u, current);
  }

  @Get('me/status')
  @ApiOperation({ summary: 'Is the phone with this device identifier registered?' })
  async status(@CurrentUser() u: AuthUser, @Query('identifier') identifier: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { deviceToken, ...result } = await this.devices.status(u, String(identifier || ''), readDeviceCookie(req, u));
    if (deviceToken) setDeviceCookie(res, u, deviceToken);
    return result;
  }

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Phones of all employees; filter by status=pending for approvals.' })
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.devices.list(requireCompany(u), u, status);
  }

  @Post(':id/approve')
  @Roles(...ADMIN_ROLES)
  approve(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.devices.decide(requireCompany(u), id, 'approve', u, clientIp(req));
  }

  @Post(':id/reject')
  @Roles(...ADMIN_ROLES)
  reject(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.devices.decide(requireCompany(u), id, 'reject', u, clientIp(req));
  }

  @Post(':id/revoke')
  @Roles(...ADMIN_ROLES)
  revoke(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.devices.decide(requireCompany(u), id, 'revoke', u, clientIp(req));
  }
}
