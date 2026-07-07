import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
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
@Controller('public/campaigns')
@UseGuards(ThrottlerGuard)
export class PublicCampaignController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  getPublicCampaign(@Param('token') token: string) {
    return this.campaigns.getPublicCampaign(token);
  }
}
