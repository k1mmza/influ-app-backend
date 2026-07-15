import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';

/**
 * Public, UNAUTHENTICATED campaign view — the "Share Campaign" surface. Lives in
 * its own controller (NOT under the JwtAuthGuard'd CampaignsController) and under
 * the `public/campaigns` path so there is zero chance of inheriting an auth guard
 * or colliding with the guarded `:id` routes.
 *
 * Because it is unauthenticated by design, it is rate limited: ThrottlerGuard +
 * @Throttle cap requests per IP so the 43-char share tokens can't be
 * brute-forced/scraped at scale. Throttling is applied ONLY here — the
 * authenticated API is untouched.
 */
@ApiTags('Public Campaigns')
@Controller('public/campaigns')
@UseGuards(ThrottlerGuard)
export class PublicCampaignController {
  constructor(private readonly campaigns: CampaignsService) {}

  @ApiOperation({
    summary: 'Get a shared campaign brief',
    description:
      'Public — no authentication required. Resolves a CampaignShareLink token (usable only while revokedAt is null and expiresAt is null or in the future). Rate limited to 30 requests/minute per IP.',
  })
  @ApiParam({ name: 'token', description: 'CampaignShareLink token (public lookup key, not the campaign id)' })
  @ApiResponse({ status: 200, description: 'Public campaign brief.' })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  getPublicCampaign(@Param('token') token: string) {
    return this.campaigns.getPublicCampaign(token);
  }

  /**
   * Public influencers preview for a campaign shortlist share token. Distinct
   * token namespace from the brief share above (CampaignShortlistShareLink), so a
   * brief token won't resolve here and vice versa. Same throttle applies.
   */
  @ApiOperation({
    summary: 'Get a shared campaign influencer shortlist',
    description:
      'Public — no authentication required. Resolves a CampaignShortlistShareLink token, distinct from the campaign brief token above. Rate limited to 30 requests/minute per IP.',
  })
  @ApiParam({ name: 'token', description: 'CampaignShortlistShareLink token (public lookup key)' })
  @ApiResponse({ status: 200, description: 'Public influencer shortlist preview (includes proposedPrice/recommendationNote).' })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token/influencers')
  getPublicInfluencerList(@Param('token') token: string) {
    return this.campaigns.getPublicInfluencerList(token);
  }
}
