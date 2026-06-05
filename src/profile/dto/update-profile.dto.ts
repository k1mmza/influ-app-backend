import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateBrandProfileDto } from './update-brand-profile.dto';
import { UpdateInfluencerProfileDto } from './update-influencer-profile.dto';

export class UpdateProfileDto {
  // Shared — updates users table
  @IsOptional() @IsString() name?: string;

  // Brand / Agency fields
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBrandProfileDto)
  profile?: UpdateBrandProfileDto;

  // Influencer fields
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateInfluencerProfileDto)
  influencerProfile?: UpdateInfluencerProfileDto;
}
