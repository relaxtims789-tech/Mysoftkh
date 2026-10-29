import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ATTENDANCE_TYPES, AttendanceType } from '../../domain/punch-rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ScanDeviceDto {
  @ApiProperty({ description: 'Device identifier (thumbprint of the device key)' }) @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Invalid device.' }) id: string;
  @ApiProperty({ description: 'From GET /api/attendance/challenge' }) @IsString() @MaxLength(200) challenge: string;
  @ApiProperty({ description: 'Signature of the scan message (see docs/API.md)' }) @IsString() @Matches(/^[A-Za-z0-9_-]{86}$/, { message: 'Invalid signature.' }) signature: string;
}

export class ScanDto {
  @ApiProperty({ description: 'What the camera read: the full scan URL or the bare token' }) @IsString() @MaxLength(500) qrToken: string;
  @ApiPropertyOptional({ example: 11.5565 }) @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) latitude?: number;
  @ApiPropertyOptional({ example: 104.9283 }) @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) longitude?: number;
  @ApiPropertyOptional({ example: 12, description: 'GPS accuracy in metres' }) @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) accuracy?: number;
  @ApiPropertyOptional({ enum: ATTENDANCE_TYPES, description: 'Omit to let the server decide (check-in, lunch, check-out)' })
  @IsOptional() @IsIn(ATTENDANCE_TYPES as unknown as string[]) type?: AttendanceType;
  @ApiPropertyOptional({ description: 'Confirms a check-out before the end of the working day' }) @IsOptional() @IsBoolean() confirmEarly?: boolean;
  @ApiPropertyOptional({ type: ScanDeviceDto }) @IsOptional() @ValidateNested() @Type(() => ScanDeviceDto) device?: ScanDeviceDto;
}

/** Check-in / check-out button (no QR). Same body as a scan without the QR token; the type is required. */
export class PunchDto {
  @ApiProperty({ enum: ATTENDANCE_TYPES }) @IsIn(ATTENDANCE_TYPES as unknown as string[]) type: AttendanceType;
  @ApiPropertyOptional({ example: 11.5565 }) @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) latitude?: number;
  @ApiPropertyOptional({ example: 104.9283 }) @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) longitude?: number;
  @ApiPropertyOptional({ example: 12 }) @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) accuracy?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmEarly?: boolean;
  @ApiPropertyOptional({ type: ScanDeviceDto, description: 'Signature over QRA-SCAN|challenge|BUTTON|type|lat|lng|accuracy' })
  @IsOptional() @ValidateNested() @Type(() => ScanDeviceDto) device?: ScanDeviceDto;
}

export class HistoryQuery {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE) to?: string;
  @ApiPropertyOptional({ description: 'Staff only: another employee' }) @IsOptional() @IsUUID() employeeId?: string;
}

export class LiveQuery {
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsIn(['all', 'present', 'late', 'absent', 'leave', 'not_yet', 'checked_out', 'overtime', 'early_leave', 'day_off', 'holiday']) status?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class RecordsQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(['qr', 'manual', 'correction', 'zkteco', 'face', 'import']) source?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?: number;
}

export class VoidDto {
  @ApiProperty({ example: 'Scanned by mistake' }) @IsString() @MaxLength(300) reason: string;
}
