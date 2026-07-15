import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SocialLinksDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() instagram?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() facebook?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() linkedin?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() tiktok?: string;
}

export class UpdateBrandProfileDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() companyName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() position?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() telephone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() companyDetail?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() websiteUrl?: string;

  @ApiPropertyOptional({ type: () => SocialLinksDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;
}
