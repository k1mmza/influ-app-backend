import { IsOptional, IsString } from 'class-validator';

export class SaveBriefDto {
  @IsOptional() @IsString() strategy?: string;
  @IsOptional() @IsString() concept?: string;
  @IsOptional() @IsString() briefBody?: string;
  /** Optional campaign to associate the brief with */
  @IsOptional() @IsString() campaignId?: string;
}
