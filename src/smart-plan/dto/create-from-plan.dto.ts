import { IsObject, IsOptional, IsString } from 'class-validator';

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
  @IsObject()
  campaignFields!: PlanCampaignFields;

  @IsOptional() @IsString() strategy?: string;
  @IsOptional() @IsString() concept?: string;
  @IsOptional() @IsString() briefBody?: string;

  /**
   * Optional reference image for the creator to see in the brief. Display-only —
   * uploaded via POST /smart-plan/brief-image before this call, never sent to the
   * AI generate step. Persisted onto Campaign.briefImageUrl.
   */
  @IsOptional() @IsString() briefImageUrl?: string;

  /** Required for AGENCY users — which client brand the campaign belongs to. */
  @IsOptional() @IsString() clientBrandId?: string;
}
