import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SocialLinksDto {
  @IsOptional() @IsString() instagram?: string;
  @IsOptional() @IsString() facebook?: string;
  @IsOptional() @IsString() linkedin?: string;
  @IsOptional() @IsString() tiktok?: string;
}

export class UpdateBrandProfileDto {
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() telephone?: string;
  @IsOptional() @IsString() companyDetail?: string;
  @IsOptional() @IsString() websiteUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;
}
