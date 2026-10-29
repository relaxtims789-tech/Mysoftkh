import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested, IsNotEmpty, Max } from 'class-validator';

export const EMPLOYEE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const CODE_MSG = 'Employee ID may contain letters, numbers, dot, - and _ (max 40).';
const PHONE = /^[+0-9 ()-]{6,20}$/;

export class EmployeeDto {
  @ApiProperty({ example: 'E0001' }) @Matches(EMPLOYEE_CODE, { message: CODE_MSG }) employeeCode: string;
  @ApiProperty({ example: 'Dara Sok' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiPropertyOptional({ example: '+855 12 345 678' }) @IsOptional() @Matches(PHONE, { message: 'Phone number is not valid.' }) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsEmail({}, { message: 'Email is not valid.' }) @MaxLength(160) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() positionId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string | null;
  @ApiPropertyOptional({ description: 'Empty = company default schedule' }) @IsOptional() @IsUUID() scheduleId?: string | null;
  @ApiPropertyOptional({ example: '2024-01-15' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Hire date must be YYYY-MM-DD' }) hiredOn?: string | null;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] }) @IsOptional() @IsIn(['active', 'inactive']) status?: string;
  @ApiPropertyOptional({ example: 450, description: 'Monthly salary, used to price overtime (admins / HR only)' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Salary must be a number.' }) @Min(0) @Max(1000000000) monthlySalary?: number | null;
  @ApiPropertyOptional({ example: 2.5, description: 'Hourly rate for overtime; overrides salary / hours per month' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Hourly rate must be a number.' }) @Min(0) @Max(10000000) hourlyRate?: number | null;
  @ApiPropertyOptional({ example: 1, description: 'Payroll: dependants for Tax on Salary (non-working spouse, children)' })
  @IsOptional() @IsInt() @Min(0) @Max(20) dependents?: number;
  @ApiPropertyOptional({ description: 'Payroll: resident for tax (false = flat non-resident rate)' }) @IsOptional() @IsBoolean() taxResident?: boolean;
  @ApiPropertyOptional({ description: 'Payroll: pays NSSF contributions' }) @IsOptional() @IsBoolean() nssfEnrolled?: boolean;
  @ApiPropertyOptional({ example: 'ABA Bank' }) @IsOptional() @IsString() @MaxLength(80) bankName?: string | null;
  @ApiPropertyOptional({ example: '000 123 456' }) @IsOptional() @Matches(/^[0-9A-Za-z -]{3,40}$/, { message: 'Bank account may contain letters, numbers, spaces and - (max 40).' }) bankAccount?: string | null;
  @ApiPropertyOptional({ example: 'DARA SOK' }) @IsOptional() @IsString() @MaxLength(120) bankAccountName?: string | null;
  @ApiPropertyOptional({ description: 'Initial password; empty = a temporary password is generated' }) @IsOptional() @IsString() @MaxLength(128) password?: string;
}

export class UpdateEmployeeDto extends PartialType(EmployeeDto) {}

export class EmployeeQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(['active', 'inactive', 'all']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) pageSize?: number;
}

export class ImportRowDto {
  @IsString() @MaxLength(40) employeeCode: string;
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsString() @MaxLength(120) position?: string;
  @IsOptional() @IsString() @MaxLength(120) branch?: string;
}

export class ImportEmployeesDto {
  @ApiProperty({ type: [ImportRowDto] }) @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows: ImportRowDto[];
  @ApiProperty({ description: 'Initial password for new employees (they must change it at first sign-in)' }) @IsString() @MaxLength(128) initialPassword: string;
}
