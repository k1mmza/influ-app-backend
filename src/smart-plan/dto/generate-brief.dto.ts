import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateBriefDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() campaignName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() objective?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() contentAngle?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() productInfo?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() productLinkOrWebsite?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() ctaMessage?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() targetAudience?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() brandTone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() budget?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() timeline?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() kpi?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() doDont?: string;

  /** Freeform natural-language prompt (used instead of structured fields) */
  @ApiPropertyOptional({ description: 'Freeform natural-language prompt, used instead of the structured fields above. AI-assisted.' })
  @IsOptional() @IsString() rawPrompt?: string;
}
