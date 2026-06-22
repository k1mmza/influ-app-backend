import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  @IsOptional()
  @IsString()
  @IsIn(['pdf', 'image', 'video', 'link'])
  contentType?: string;

  // Influencer may move their own draft between DRAFT and SUBMITTED only.
  // APPROVED / REVISION_REQUESTED are set exclusively via the review endpoint.
  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'SUBMITTED'])
  status?: string;
}
