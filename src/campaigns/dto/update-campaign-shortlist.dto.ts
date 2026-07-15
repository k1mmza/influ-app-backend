import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Update the recommendation note and/or proposed price for one influencer on a
 *  campaign's shortlist. Both nullable — sending null clears the field. */
export class UpdateCampaignShortlistDto {
  @ApiPropertyOptional({ description: 'Send null to clear.', nullable: true })
  @IsOptional()
  @IsString()
  recommendationNote?: string | null;

  @ApiPropertyOptional({ description: 'Proposed price in THB. Send null to clear.', minimum: 0, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  proposedPrice?: number | null;
}
