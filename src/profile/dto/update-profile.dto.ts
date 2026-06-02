import { IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() name?: string;

  // Brand / Agency
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() telephone?: string;
  @IsOptional() @IsString() companyDetail?: string;
  @IsOptional() @IsString() websiteUrl?: string;
  @IsOptional() socialLinks?: {
    instagram?: string;
    facebook?: string;
    linkedin?: string;
    tiktok?: string;
  };

  // Influencer
  @IsOptional() @IsString() bio?: string;
  @IsOptional() categories?: string[];
  @IsOptional() @IsString() availabilityStatus?: string;
}
