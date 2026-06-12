import { IsOptional, IsString } from 'class-validator';

export class GenerateBriefDto {
  @IsOptional() @IsString() campaignName?: string;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsString() contentAngle?: string;
  @IsOptional() @IsString() productInfo?: string;
  @IsOptional() @IsString() productLinkOrWebsite?: string;
  @IsOptional() @IsString() ctaMessage?: string;
  @IsOptional() @IsString() targetAudience?: string;
  @IsOptional() @IsString() brandTone?: string;
  @IsOptional() @IsString() budget?: string;
  @IsOptional() @IsString() timeline?: string;
  @IsOptional() @IsString() kpi?: string;
  @IsOptional() @IsString() doDont?: string;

  /** Freeform natural-language prompt (used instead of structured fields) */
  @IsOptional() @IsString() rawPrompt?: string;
}
