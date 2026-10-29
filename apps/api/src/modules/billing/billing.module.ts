import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser, clientIp, CurrentUser, Public, requireCompany, Roles } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { looksLikePhone } from '../../common/phone';
import { AuthModule } from '../auth/auth.module';
import { meta, setRefreshCookie } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { PASSWORD_RULE, PASSWORD_RULE_TEXT } from '../auth/auth.dto';
import { MAX_IMAGE_BYTES } from '../uploads/uploads.service';
import { BillingService, COMPANY_CODE } from './billing.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class SignupDto {
  @ApiProperty({ example: 'Sok Mean Trading Co., Ltd.' }) @IsString() @MinLength(2) @MaxLength(120) companyName: string;
  @ApiPropertyOptional({ example: 'sokmean', description: 'Code staff type when signing in; made from the name when empty' })
  @IsOptional() @ValidateIf((_, v) => v !== '') @Matches(COMPANY_CODE, { message: 'Company code must be 2-40 letters, numbers, - or _.' }) companyCode?: string;
  @ApiProperty({ example: 'Sok Mean' }) @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @ApiProperty({ example: 'owner@sokmean.com' }) @IsEmail({}, { message: 'Email is not valid.' }) @MaxLength(160) email: string;
  @ApiProperty({ example: '012 345 678' }) @IsString() @MaxLength(30) phone: string;
  @ApiProperty() @IsString() @MaxLength(128) password: string;
  @ApiProperty({ description: 'Plan (staff range) id from /public/plans' }) @IsUUID() tierId: string;
  @ApiProperty({ description: 'Must be true' }) @Equals(true, { message: 'Please accept the terms.' }) acceptTerms: boolean;
  /** Honeypot: hidden on the form, filled only by bots. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

class PlanDto {
  @IsUUID() tierId: string;
}
class InvoiceDto {
  @IsUUID() tierId: string;
  @ApiProperty({ enum: ['monthly', 'yearly'] }) @IsIn(['monthly', 'yearly']) cycle: 'monthly' | 'yearly';
}
class RefundPolicyDto {
  @ApiProperty({ example: '1.0', description: 'Version of the Cancellation & Refund Policy the customer accepted (must be the current one)' })
  @IsOptional() @IsString() @MaxLength(20) policyVersion?: string;
}
class TransferDto {
  @ApiProperty({ example: '1.0', description: 'Accepted Cancellation & Refund Policy version' }) @IsOptional() @IsString() @MaxLength(20) policyVersion?: string;
  @ApiProperty({ enum: ['aba', 'acleda'] }) @IsIn(['aba', 'acleda']) bank: 'aba' | 'acleda';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class NoteDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class RejectDto {
  @ApiProperty({ example: 'Amount does not match' }) @IsString() @MinLength(3) @MaxLength(300) note: string;
}
class TierDto {
  @IsOptional() @IsUUID() id?: string;
  @IsInt() @Min(1) @Max(1000000) minStaff: number;
  @IsInt() @Min(1) @Max(1000000) maxStaff: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) monthlyPrice: number;
  @ApiPropertyOptional({ description: 'Active branches allowed; null = unlimited', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(100000) maxBranches?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
class TiersDto {
  @ApiProperty({ type: [TierDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => TierDto) tiers: TierDto[];
}
const opt = () => IsOptional();
class PlatformSettingsDto {
  @ApiPropertyOptional({ description: 'Free trial for new sign-ups (months)' }) @opt() @IsInt() @Min(1) @Max(3) trialMonths?: number;
  @opt() @IsInt() @Min(0) @Max(60) graceDays?: number;
  @ApiPropertyOptional({ description: 'Months free when paying yearly' }) @opt() @IsInt() @Min(0) @Max(11) yearlyFreeMonths?: number;
  @opt() @IsString() @MaxLength(120) abaAccountName?: string;
  @opt() @IsString() @MaxLength(60) abaAccountNumber?: string;
  @opt() @IsString() @MaxLength(120) acledaAccountName?: string;
  @opt() @IsString() @MaxLength(60) acledaAccountNumber?: string;
  @opt() @IsBoolean() paywayEnabled?: boolean;
  @opt() @IsBoolean() paywaySandbox?: boolean;
  @opt() @IsString() @MaxLength(60) paywayMerchantId?: string;
  @ApiPropertyOptional({ description: 'Write-only; empty string removes it' }) @opt() @IsString() @MaxLength(400) paywayApiKey?: string;
  @opt() @IsString() @MaxLength(40) salesPhone?: string;
  @opt() @IsString() @MaxLength(80) salesTelegram?: string;
  @opt() @IsString() @MaxLength(160) salesEmail?: string;
  @ApiPropertyOptional({ description: 'Write-only; empty string removes it' }) @opt() @IsString() @MaxLength(200) telegramBotToken?: string;
  @ApiPropertyOptional({ description: "Admins' bot token. Write-only; empty string removes it" }) @opt() @IsString() @MaxLength(200) telegramAdminBotToken?: string;
  @opt() @IsString() @MaxLength(60) telegramChatId?: string;
}
class AdjustDto {
  @opt() @IsBoolean() exempt?: boolean;
  @ApiPropertyOptional({ example: '2026-12-31', nullable: true }) @opt() @ValidateIf((_, v) => v !== null) @Matches(DATE) trialEndsAt?: string | null;
  @ApiPropertyOptional({ example: '2027-06-30', nullable: true }) @opt() @ValidateIf((_, v) => v !== null) @Matches(DATE) paidUntil?: string | null;
  @opt() @ValidateIf((_, v) => v !== null) @IsUUID() tierId?: string | null;
  @opt() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) note?: string | null;
  @ApiPropertyOptional({ description: 'true = use branchLimit below instead of the plan' }) @opt() @IsBoolean() branchLimitCustom?: boolean;
  @ApiPropertyOptional({ description: 'Branches allowed when custom; null = unlimited', nullable: true }) @opt() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(100000) branchLimit?: number | null;
}
class RecordPaymentDto {
  @IsUUID() tierId: string;
  @IsIn(['monthly', 'yearly']) cycle: 'monthly' | 'yearly';
  @opt() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10000000) amount?: number;
  @opt() @IsString() @MaxLength(300) note?: string;
}

const receiptUpload = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const imageUpload = FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

/** The public website: plans, sign-up with a free trial, PayWay pushback. */
@ApiTags('Public website')
@Controller('public')
export class PublicController {
  constructor(private readonly billing: BillingService, private readonly auth: AuthService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Prices by number of staff, free trial length, payment methods and sales contact.' })
  plans() {
    return this.billing.publicInfo();
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('company-code')
  @ApiOperation({ summary: 'Is a company code free? Without `code`, suggests one from `name`.' })
  async code(@Query('code') code?: string, @Query('name') name?: string) {
    if (code) return { code, ...(await this.billing.codeAvailable(code.trim())) };
    if (name?.trim()) return { code: await this.billing.suggestCode(name.slice(0, 120)), available: true, valid: true };
    throw badRequest('Give a code or a name.', 'BAD_REQUEST');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('signup')
  @ApiOperation({ summary: 'Create a company with its admin and start the free trial; signs the admin in.' })
  async signup(@Body() dto: SignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (dto.website) throw badRequest('Sign-up failed.', 'REJECTED');
    if (!PASSWORD_RULE.test(dto.password)) throw badRequest(PASSWORD_RULE_TEXT, 'WEAK_PASSWORD');
    if (!looksLikePhone(dto.phone)) throw badRequest('Phone number is not valid.', 'BAD_PHONE');
    const r = await this.billing.signup(dto, clientIp(req));
    const s = await this.auth.login(undefined, r.email, dto.password, meta(req));
    setRefreshCookie(res, s);
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, user: await this.auth.profileFor(s.userId), companyCode: r.companyCode, trialEndsAt: r.trialEndsAt };
  }

  /** PayWay calls this after a payment (return_url). The payment is confirmed with PayWay's check-transaction API. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('payway/callback')
  @HttpCode(200)
  async paywayCallback(@Body() body: any, @Query('tran_id') q?: string) {
    const tranId = typeof body?.tran_id === 'string' ? body.tran_id : typeof q === 'string' ? q : undefined;
    return this.billing.paywayCallback(tranId);
  }
}

/** The company admin's billing: plan, invoices, paying. Allowed even when the company is read-only. */
@ApiTags('Billing')
@ApiBearerAuth()
@Roles('super_admin', 'company_admin')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Subscription state, plan, staff count, prices, payment options and invoices.' })
  overview(@CurrentUser() u: AuthUser) {
    return this.billing.overview(requireCompany(u));
  }

  @Post('plan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change the plan during the trial or after it lapsed.' })
  plan(@Body() dto: PlanDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.billing.choosePlan(u, dto.tierId, clientIp(req));
  }

  @Post('invoices')
  @ApiOperation({ summary: 'Invoice for a plan and cycle (or an upgrade during a paid period).' })
  invoice(@Body() dto: InvoiceDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.billing.createInvoice(requireCompany(u), dto.tierId, dto.cycle, u, clientIp(req));
  }

  @Post('invoices/:id/payway')
  @HttpCode(200)
  @ApiOperation({ summary: 'Signed form for ABA PayWay checkout (the browser posts it to PayWay). Needs the accepted refund policy version.' })
  payway(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundPolicyDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.billing.paywayCheckout(u, id, dto.policyVersion, clientIp(req));
  }

  @Post('invoices/:id/check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask PayWay whether the invoice is paid (after returning from PayWay).' })
  check(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    requireCompany(u);
    return this.billing.verifyForUser(u, id);
  }

  @Post('invoices/:id/transfer')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(receiptUpload)
  @ApiOperation({ summary: 'Bank transfer: upload the receipt (image or PDF, max 5 MB) for the super admin to approve.' })
  transfer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferDto, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.billing.submitTransfer(u, id, dto.bank, file, dto.note, clientIp(req), dto.policyVersion);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    requireCompany(u);
    return this.billing.cancelInvoice(u, id, clientIp(req));
  }

  @Get('invoices/:id/receipt')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const r = await this.billing.receipt(u, id);
    res.setHeader('Content-Type', r.type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(r.file);
  }
}

/** Super admin: subscriptions, payments to check, prices, trial length, bank accounts, PayWay. */
@ApiTags('Platform (super admin)')
@ApiBearerAuth()
@Roles('super_admin')
@Controller('platform')
export class PlatformController {
  constructor(private readonly billing: BillingService) {}

  @Get('settings')
  settings() {
    return this.billing.adminSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Trial months (1-3), grace days, yearly discount, bank accounts, ABA PayWay, sales contact, Telegram alerts.' })
  updateSettings(@Body() dto: PlatformSettingsDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.billing.updateSettings(dto, u, clientIp(req));
  }

  @Post('settings/qr/:bank')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(imageUpload)
  @ApiOperation({ summary: 'Upload (or, without a file, remove) the KHQR image of the ABA / ACLEDA account, or the website Telegram QR (bank=telegram).' })
  qr(@Param('bank') bank: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() u: AuthUser, @Req() req: Request) {
    if (bank !== 'aba' && bank !== 'acleda' && bank !== 'telegram') throw badRequest('Must be aba, acleda or telegram.', 'BAD_BANK');
    return this.billing.setBankQr(bank, file, u, clientIp(req));
  }

  @Post('settings/payway-test')
  @HttpCode(200)
  paywayTest() {
    return this.billing.testPayway();
  }

  @Post('settings/telegram-test')
  @HttpCode(200)
  telegramTest() {
    return this.billing.testTelegram();
  }

  @Get('tiers')
  tiers() {
    return this.billing.tiers(true);
  }

  @Put('tiers')
  @ApiOperation({ summary: 'Prices per staff range. Ranges left out are hidden (kept for existing customers).' })
  updateTiers(@Body() dto: TiersDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.billing.updateTiers(dto.tiers, u, clientIp(req));
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'Every company with its trial / paid dates, state, plan and staff count.' })
  subscriptions() {
    return this.billing.subscriptions();
  }

  @Put('companies/:id/billing')
  @ApiOperation({ summary: 'Adjust a company: extend the trial, set paid-until, change the plan, mark free.' })
  adjust(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.billing.adjustCompany(id, dto, u, clientIp(req));
  }

  @Post('companies/:id/payments')
  @ApiOperation({ summary: 'Record a payment received outside the app (cash, other bank).' })
  record(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.billing.recordPayment(id, dto, u, clientIp(req));
  }

  @Get('invoices')
  invoices(@Query('status') status?: string) {
    return this.billing.invoices(status);
  }

  @Get('invoices/pending-count')
  async pending() {
    return { pending: await this.billing.pendingCount() };
  }

  @Post('invoices/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.billing.markPaid(id, 'bank_transfer', u, dto.note?.trim() || null, clientIp(req));
  }

  @Post('invoices/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.billing.reject(id, u, dto.note, clientIp(req));
  }

  @Post('invoices/:id/check')
  @HttpCode(200)
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.verifyPayway(id);
  }
}

@Module({ imports: [AuthModule], controllers: [PublicController, BillingController, PlatformController], providers: [BillingService], exports: [BillingService] })
export class BillingModule {}
