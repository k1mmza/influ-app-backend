import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class InviteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  influencerId!: string;
}
