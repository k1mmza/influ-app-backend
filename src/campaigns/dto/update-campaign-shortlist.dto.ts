import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Update the recommendation note and/or proposed price for one influencer on a
 *  campaign's shortlist. Both nullable — sending null clears the field. */
export class UpdateCampaignShortlistDto {
  @IsOptional()
  @IsString()
  recommendationNote?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  proposedPrice?: number | null;
}
