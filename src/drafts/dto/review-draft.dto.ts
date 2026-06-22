import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewDraftDto {
  // Brand/agency decision on an influencer's draft.
  @IsString()
  @IsIn(['APPROVED', 'REVISION_REQUESTED'])
  status: string;

  // Required feedback when requesting a revision (enforced in the service).
  @IsOptional()
  @IsString()
  revisionNote?: string;
}
