import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

class RateCardDto {
  @IsOptional() @IsNumber() pricePerPost?: number;
  @IsOptional() @IsNumber() pricePerVideo?: number;
  @IsOptional() @IsNumber() pricePerStory?: number;
  @IsOptional() @IsNumber() packagePrice?: number;
  @IsOptional() @IsString() packageDescription?: string;
}

export class UpdateInfluencerProfileDto {
  @IsOptional() @IsString() bio?: string;

  @IsOptional()
  @IsArray()
  categories?: string[];

  @IsOptional()
  @IsArray()
  styleTags?: string[];

  @IsOptional()
  @IsArray()
  keywords?: string[];

  @IsOptional()
  @IsArray()
  hashtags?: string[];

  @IsOptional() @IsString() availabilityStatus?: string;

  @IsOptional() @IsString() country?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  responseRate?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => RateCardDto)
  rateCard?: RateCardDto;
}
