import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsNumber,
  IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;
const CODE_MSG = 'Code must be 2-40 letters, numbers, - or _.';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCompanyDto {
  @ApiProperty({ example: 'CAM Demo Co., Ltd.' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiProperty({ example: 'camdemo', description: 'Short code employees type when signing in' }) @Matches(CODE, { message: CODE_MSG }) code: string;
  @ApiPropertyOptional({ example: 'Asia/Phnom_Penh' }) @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @ApiProperty({ example: 'Sokha Chan' }) @IsString() @IsNotEmpty() @MaxLength(120) adminName: string;
  @ApiProperty({ example: 'admin@camdemo.com' }) @IsEmail() @MaxLength(160) adminEmail: string;
  @ApiPropertyOptional({ description: 'Leave empty to generate a temporary password' }) @IsOptional() @IsString() @MaxLength(128) adminPassword?: string;
  @ApiPropertyOptional({ description: 'Free company (no trial end, no billing)' }) @IsOptional() @IsBoolean() free?: boolean;
}

export class UpdateCompanyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(CODE, { message: CODE_MSG }) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @ApiPropertyOptional({ enum: ['active', 'suspended'] }) @IsOptional() @IsIn(['active', 'suspended']) status?: string;
}

export class UpdateRulesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowLunchScan?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireGps?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireDeviceBinding?: boolean;
  @ApiPropertyOptional({ enum: ['auto_first', 'admin'], description: 'auto_first: the first phone is approved automatically; admin: every phone needs approval' })
  @IsOptional() @IsIn(['auto_first', 'admin']) deviceApprovalMode?: 'auto_first' | 'admin';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowOvertime?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(600) overtimeMinMinutes?: number;
  @ApiPropertyOptional({ example: 100, description: 'Default radius (m) for branches without their own: 0.5 to 5000, up to 2 decimals' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'Radius must be a number with at most 2 decimals.' }) @Min(0.5, { message: 'Radius must be at least 0.5 m.' }) @Max(5000) geofenceRadius?: number;
  @ApiPropertyOptional({ description: 'Reject GPS fixes less accurate than this (m)' }) @IsOptional() @IsInt() @Min(5) @Max(5000) maxGpsAccuracy?: number;
  @ApiPropertyOptional({ description: 'Ignore repeat scans within this many seconds' }) @IsOptional() @IsInt() @Min(0) @Max(3600) minScanIntervalSeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() restrictToHomeBranch?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowEmployeeCorrections?: boolean;
  @ApiPropertyOptional({ description: 'Check-in / check-out buttons on the phone without scanning the QR (GPS + phone still checked)' })
  @IsOptional() @IsBoolean() allowButtonCheckin?: boolean;
}

export class BranchDto {
  @ApiProperty({ example: 'Phnom Penh Office' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiProperty({ example: 'PP' }) @Matches(CODE, { message: CODE_MSG }) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiProperty({ example: 11.5564 }) @Type(() => Number) @IsLatitude() latitude: number;
  @ApiProperty({ example: 104.9282 }) @Type(() => Number) @IsLongitude() longitude: number;
  @ApiPropertyOptional({ example: 100, description: 'Allowed radius in metres (0.5 to 5000, up to 2 decimals); empty = company default' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'Radius must be a number with at most 2 decimals.' }) @Min(0.5, { message: 'Radius must be at least 0.5 m.' }) @Max(5000) radius?: number | null;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] }) @IsOptional() @IsIn(['active', 'inactive']) status?: string;
}
export class UpdateBranchDto extends PartialType(BranchDto) {}

export class NamedDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] }) @IsOptional() @IsIn(['active', 'inactive']) status?: string;
}

export class ScheduleDto {
  @ApiProperty({ example: 'Office hours' }) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @ApiProperty({ example: '08:00' }) @Matches(HHMM, { message: 'Start time must be HH:MM' }) startTime: string;
  @ApiProperty({ example: '17:00' }) @Matches(HHMM, { message: 'End time must be HH:MM' }) endTime: string;
  @ApiPropertyOptional({ example: '12:00' }) @IsOptional() @Matches(HHMM, { message: 'Lunch start must be HH:MM' }) lunchStart?: string | null;
  @ApiPropertyOptional({ example: '13:00' }) @IsOptional() @Matches(HHMM, { message: 'Lunch end must be HH:MM' }) lunchEnd?: string | null;
  @ApiProperty({ example: 15, description: 'Late after start + N minutes' }) @IsInt() @Min(0) @Max(240) lateAfterMinutes: number;
  @ApiProperty({ example: 5, description: 'Grace for early check-out and lunch return' }) @IsInt() @Min(0) @Max(120) graceMinutes: number;
  @ApiProperty({ example: [1, 2, 3, 4, 5], description: 'ISO weekdays, 1 = Monday' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) workDays: number[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] }) @IsOptional() @IsIn(['active', 'inactive']) status?: string;
}
export class UpdateScheduleDto extends PartialType(ScheduleDto) {}

export class HolidayDto {
  @ApiProperty({ example: 'Water Festival' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiProperty({ example: '2026-11-24' }) @Matches(DATE, { message: 'Date must be YYYY-MM-DD' }) date: string;
}

