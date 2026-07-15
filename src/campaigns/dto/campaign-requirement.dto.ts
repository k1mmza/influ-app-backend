import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CampaignRequirementDto {
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minFollowers?: number;

  // Relaxed from @IsInt to @IsNumber: the schema is Float? and the AI returns
  // fractional engagement rates like 2.5. This also affects the normal Create
  // Campaign path (shared DTO) — intentional and correct, the column was always Float.
  @ApiPropertyOptional({ minimum: 0, example: 2.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minEngagementRate?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minAvgViews?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  followerTier?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contentType?: string;
}
