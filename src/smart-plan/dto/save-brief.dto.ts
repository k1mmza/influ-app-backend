import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SaveBriefDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() strategy?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() concept?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() briefBody?: string;

  /** Optional campaign to associate the brief with */
  @ApiPropertyOptional({ description: 'Optional campaign to associate the brief with. A brief can exist before a campaign is chosen.' })
  @IsOptional() @IsString() campaignId?: string;
}
