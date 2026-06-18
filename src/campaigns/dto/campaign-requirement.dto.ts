import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CampaignRequirementDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  minFollowers?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minEngagementRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minAvgViews?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsString()
  followerTier?: string;

  @IsOptional()
  @IsString()
  contentType?: string;
}
