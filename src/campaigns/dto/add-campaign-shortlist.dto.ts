import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Add an influencer to a campaign's client-review shortlist. Note/price are
 *  optional at add time and can be filled in later via PATCH. */
export class AddCampaignShortlistDto {
  @ApiProperty()
  @IsString()
  influencerId!: string;

  @ApiPropertyOptional({ description: '"Why we recommend them" note shown to the client.' })
  @IsOptional()
  @IsString()
  recommendationNote?: string;

  @ApiPropertyOptional({ description: 'Proposed price in THB.', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  proposedPrice?: number;
}
