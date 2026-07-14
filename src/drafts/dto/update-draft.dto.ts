import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDraftDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkUrl?: string;

  @ApiPropertyOptional({ enum: ['pdf', 'image', 'video', 'link'] })
  @IsOptional()
  @IsString()
  @IsIn(['pdf', 'image', 'video', 'link'])
  contentType?: string;

  // Influencer may move their own draft between DRAFT and SUBMITTED only.
  // APPROVED / REVISION_REQUESTED are set exclusively via the review endpoint.
  @ApiPropertyOptional({ enum: ['DRAFT', 'SUBMITTED'], description: 'Influencer may only move their own draft between DRAFT and SUBMITTED. APPROVED/REVISION_REQUESTED are set exclusively via the review endpoint.' })
  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'SUBMITTED'])
  status?: string;
}
