import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsEnum,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';

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
