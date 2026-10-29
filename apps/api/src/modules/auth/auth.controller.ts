import { Body, Controller, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { config } from '../../config';
import { AllowPendingPasswordChange, AuthUser, clientIp, CurrentUser, Public } from '../../common/auth';
import { AuthService, IssuedSession } from './auth.service';
import { ChangePasswordDto, LoginDto } from './auth.dto';

const COOKIE = 'qra_rt';
const COOKIE_PATH = '/api/auth';

/** Sets the httpOnly refresh-token cookie of a new session (also used right after sign-up). */
export function setRefreshCookie(res: Response, s: IssuedSession) {
  res.cookie(COOKIE, s.refreshToken, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: COOKIE_PATH, expires: s.refreshExpires });
}

export function meta(req: Request) {
  return { ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '') };
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setCookie(res: Response, s: IssuedSession) {
    setRefreshCookie(res, s);
  }

  private async respond(req: Request, res: Response, s: IssuedSession) {
    this.setCookie(res, s);
    const company = req.headers['x-company-id'];
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, user: await this.auth.profileFor(s.userId, typeof company === 'string' ? company : undefined) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in. Returns an access token; the refresh token is set as an httpOnly cookie.' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.login(dto.companyCode, dto.login, dto.password, meta(req));
    return this.respond(req, res, s);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh-token cookie and get a new access token.' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const s = await this.auth.refresh(req.cookies?.[COOKIE], meta(req));
      return await this.respond(req, res, s);
    } catch (e) {
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out: revokes the refresh token family and clears the cookie.' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    return { ok: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @AllowPendingPasswordChange()
  @ApiOperation({ summary: 'The signed-in user, company and employee profile.' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Put('password')
  @ApiBearerAuth()
  @AllowPendingPasswordChange()
  @ApiOperation({ summary: 'Change own password. Other sessions are signed out.' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, req.cookies?.[COOKIE], clientIp(req));
    return { ok: true };
  }
}
