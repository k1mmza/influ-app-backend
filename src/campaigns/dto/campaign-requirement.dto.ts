import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CampaignRequirementDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  minFollowers?: number;

  // Relaxed from @IsInt to @IsNumber: the schema is Float? and the AI returns
  // fractional engagement rates like 2.5. This also affects the normal Create
  // Campaign path (shared DTO) — intentional and correct, the column was always Float.
  @IsOptional()
  @IsNumber()
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
