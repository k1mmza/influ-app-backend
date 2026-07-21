import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'The raw token from the emailed reset link.' })
  @IsString()
  @IsNotEmpty()
  token: string;

  // Same rule as RegisterDto so the reset flow can't set a weaker password.
  @ApiProperty({ minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
