import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({ example: 'camdemo', description: 'Company code. Required for employees signing in with their employee ID.' })
  @IsOptional() @IsString() @MaxLength(40)
  companyCode?: string;

  @ApiProperty({ example: 'E0001', description: 'Employee ID, username or email' })
  @IsString() @MinLength(1) @MaxLength(120)
  login: string;

  @ApiProperty({ example: 'Demo@1234' })
  @IsString() @MinLength(1) @MaxLength(200)
  password: string;
}

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
export const PASSWORD_RULE_TEXT = 'Password must be at least 8 characters and contain a letter and a number.';

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(200)
  currentPassword: string;

  @ApiProperty({ description: PASSWORD_RULE_TEXT })
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_TEXT })
  newPassword: string;
}
