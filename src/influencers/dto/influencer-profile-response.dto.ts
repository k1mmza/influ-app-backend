import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shape returned by InfluencersService.findAll/findOne/lookupByHandle (via the
 * private formatInfluencer() helper) — a formatted/computed view over
 * InfluencerProfile plus its joined user/platformAccounts/audienceInsights/
 * rateCards relations, not a raw Prisma passthrough. Nested relation fields are
 * described in prose rather than itemized field-by-field.
 */
export class InfluencerProfileResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({
    description: 'Owning user id. Null for external/unclaimed profiles created from a URL search (see isExternal/claimed).',
    nullable: true,
  })
  userId: string | null;

  @ApiPropertyOptional({ nullable: true })
  bio: string | null;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other'], nullable: true })
  gender: string | null;

  @ApiPropertyOptional({ type: [String], nullable: true, example: ['beauty', 'lifestyle'] })
  categories: string[] | null;

  @ApiPropertyOptional({ nullable: true })
  country: string | null;

  @ApiPropertyOptional({ nullable: true })
  performanceScore: number | null;

  @ApiPropertyOptional({ nullable: true })
  qualityScore: number | null;

  @ApiPropertyOptional({ nullable: true })
  audienceQualityScore: number | null;

  @ApiPropertyOptional({ nullable: true })
  growthRate: number | null;

  @ApiPropertyOptional({ description: 'True for profiles created from a URL search rather than self-registration.' })
  isExternal: boolean;

  @ApiPropertyOptional({ description: 'True once claimed by a real user account.' })
  claimed: boolean;

  @ApiPropertyOptional({
    description: 'Joined user summary (name/email/avatarUrl or full user record, depending on route). Present only when userId is set.',
    nullable: true,
  })
  user: object | null;

  @ApiPropertyOptional({ description: 'Joined platform accounts with audience insights.', type: [Object] })
  platformAccounts: object[];
}
