import { IsNotEmpty, IsString } from 'class-validator';

export class InviteDto {
  @IsString()
  @IsNotEmpty()
  influencerId!: string;
}
