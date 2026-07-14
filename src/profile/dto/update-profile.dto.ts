import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateBrandProfileDto } from './update-brand-profile.dto';
import { UpdateInfluencerProfileDto } from './update-influencer-profile.dto';

export class UpdateProfileDto {
  // Shared — updates users table
  @ApiPropertyOptional()
  @IsOptional() @IsString() name?: string;

  // Pass "" to clear the avatar
  @ApiPropertyOptional({ description: 'Pass "" to clear the avatar.' })
  @IsOptional() @IsString() avatarUrl?: string;

  // Brand / Agency fields
  @ApiPropertyOptional({ type: () => UpdateBrandProfileDto, description: 'Brand or agency profile fields (same shape for both roles).' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBrandProfileDto)
  profile?: UpdateBrandProfileDto;

  // Influencer fields
  @ApiPropertyOptional({ type: () => UpdateInfluencerProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateInfluencerProfileDto)
  influencerProfile?: UpdateInfluencerProfileDto;
}
