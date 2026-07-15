import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewDraftDto {
  // Brand/agency decision on an influencer's draft.
  @ApiProperty({ enum: ['APPROVED', 'REVISION_REQUESTED'] })
  @IsString()
  @IsIn(['APPROVED', 'REVISION_REQUESTED'])
  status: string;

  // Required feedback when requesting a revision (enforced in the service).
  @ApiPropertyOptional({ description: 'Required when status is REVISION_REQUESTED (enforced in the service).' })
  @IsOptional()
  @IsString()
  revisionNote?: string;
}
