import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentType?: string;
}
