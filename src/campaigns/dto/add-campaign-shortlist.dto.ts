import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Add an influencer to a campaign's client-review shortlist. Note/price are
 *  optional at add time and can be filled in later via PATCH. */
export class AddCampaignShortlistDto {
  @IsString()
  influencerId!: string;

  @IsOptional()
  @IsString()
  recommendationNote?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  proposedPrice?: number;
}
