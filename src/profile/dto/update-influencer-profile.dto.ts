import {
  IsOptional,
  IsString,
  IsArray,
  IsBoolean,
  IsNumber,
  IsEnum,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, ProfileVisibility } from '@prisma/client';

// Self-reported media-kit audience. Persisted to InfluencerProfile.mediaKitAudience
// (Json) and used only as a DISPLAY FALLBACK — synced platform data always wins.
class MediaKitAudienceDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() totalFollowers?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() averageViews?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() engagementRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() growthRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() age?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() topCountries?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() topCities?: string[];
}

class RateCardDto {
  @ApiPropertyOptional()
  @IsOptional() @IsNumber() pricePerPost?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() pricePerVideo?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() pricePerStory?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() packagePrice?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() packageDescription?: string;
}

export class UpdateInfluencerProfileDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() bio?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional() @IsEnum(Gender) gender?: Gender;

  @ApiPropertyOptional({ type: [String], example: ['beauty', 'lifestyle'] })
  @IsOptional()
  @IsArray()
  categories?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  styleTags?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  keywords?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  hashtags?: string[];

  @ApiPropertyOptional()
  @IsOptional() @IsString() availabilityStatus?: string;

  @ApiPropertyOptional({ enum: ProfileVisibility })
  @IsOptional() @IsEnum(ProfileVisibility) visibility?: ProfileVisibility;

  @ApiPropertyOptional({ description: 'Receive message notifications.' })
  @IsOptional() @IsBoolean() messageAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive campaign notifications (invitations, applications, drafts).' })
  @IsOptional() @IsBoolean() campaignAlerts?: boolean;

  @ApiPropertyOptional({ type: () => MediaKitAudienceDto, description: 'Self-reported audience (display fallback; synced data wins).' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaKitAudienceDto)
  mediaKitAudience?: MediaKitAudienceDto;

  @ApiPropertyOptional()
  @IsOptional() @IsString() country?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  responseRate?: number;

  @ApiPropertyOptional({ type: () => RateCardDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RateCardDto)
  rateCard?: RateCardDto;
}
