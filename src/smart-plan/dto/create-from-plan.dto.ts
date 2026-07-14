import { IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Nested requirements block as the AI returns it (loosely typed — values are coerced in the service). */
export interface PlanRequirements {
  minFollowers?: number | null;
  minEngagementRate?: number | null;
  minAvgViews?: number | null;
  platforms?: string[] | null;
  locations?: string[] | null;
  categories?: string[] | null;
  contentType?: string | null;
}

/** Inferred campaign fields produced by /smart-plan/generate. */
export interface PlanCampaignFields {
  name?: string | null;
  objective?: string | null;
  budget?: number | string | null;
  visibility?: string | null;
  paymentType?: string | null;
  keyMessage?: string | null;
  doAndDont?: string | null;
  deliverables?: string | null;
  applyDeadline?: string | null;
  submissionDate?: string | null;
  reviewDate?: string | null;
  paymentDate?: string | null;
  requirements?: PlanRequirements | null;
}

export class CreateFromPlanDto {
  // @IsObject keeps the nested object from being stripped by the global whitelist pipe.
  @ApiProperty({
    description: 'Inferred campaign fields, normally the output of POST /smart-plan/generate, confirmed/edited by the user before this call. Loosely typed — coerced in the service.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  campaignFields!: PlanCampaignFields;

  @ApiPropertyOptional()
  @IsOptional() @IsString() strategy?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() concept?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() briefBody?: string;

  /**
   * Optional reference image for the creator to see in the brief. Display-only —
   * uploaded via POST /smart-plan/brief-image before this call, never sent to the
   * AI generate step. Persisted onto Campaign.briefImageUrl.
   */
  @ApiPropertyOptional({ description: 'Reference image URL for the creator to see in the brief. Upload via POST /smart-plan/brief-image first; display-only, never sent to the AI generate step.' })
  @IsOptional() @IsString() briefImageUrl?: string;

  /** Required for AGENCY users — which client brand the campaign belongs to. */
  @ApiPropertyOptional({ description: 'Required for AGENCY users — which client brand the campaign belongs to.' })
  @IsOptional() @IsString() clientBrandId?: string;
}
