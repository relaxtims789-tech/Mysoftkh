import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { ADMIN_ROLES, AuthUser, clientIp, CurrentUser, Public, requireCompany, Roles } from '../../common/auth';
import { QrService } from './qr.service';

const uuid = new ParseUUIDPipe();

class CreateQrDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiPropertyOptional({ example: 'Main entrance' }) @IsOptional() @IsString() @MaxLength(80) label?: string;
}

@ApiTags('QR codes')
@ApiBearerAuth()
@Controller('qr')
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('resolve/:token')
  @ApiOperation({ summary: 'Public: which branch a scanned QR belongs to (shown before sign-in).' })
  resolve(@Param('token') token: string) {
    return this.qr.resolve(token);
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Create a QR code for a branch.' })
  create(@Body() dto: CreateQrDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.qr.create(requireCompany(u), dto.branchId, dto.label, u, clientIp(req));
  }

  @Get()
  @Roles(...ADMIN_ROLES)
  list(@CurrentUser() u: AuthUser, @Query('branchId') branchId?: string) {
    return this.qr.list(requireCompany(u), branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Get(':id')
  @Roles(...ADMIN_ROLES)
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.qr.get(requireCompany(u), id);
  }

  @Post(':id/regenerate')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Issue a new token. Printed copies of the old QR stop working.' })
  regenerate(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.qr.regenerate(requireCompany(u), id, u, clientIp(req));
  }

  @Post(':id/disable')
  @Roles(...ADMIN_ROLES)
  disable(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.qr.setStatus(requireCompany(u), id, 'disabled', u, clientIp(req));
  }

  @Post(':id/enable')
  @Roles(...ADMIN_ROLES)
  enable(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.qr.setStatus(requireCompany(u), id, 'active', u, clientIp(req));
  }

  @Get(':id/print')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Data for the printable poster: QR as SVG, company name/logo, branch.' })
  print(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.qr.printData(requireCompany(u), id);
  }

  @Get(':id/image.png')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Download the QR as a PNG image.' })
  async png(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Res() res: Response, @Query('size') size?: string) {
    const { buffer, filename } = await this.qr.png(requireCompany(u), id, Number(size) || 1024);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
