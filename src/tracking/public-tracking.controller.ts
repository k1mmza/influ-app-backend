import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TrackingService } from './tracking.service';

/**
 * Public, UNAUTHENTICATED tracking report — the "Share Report" surface. Lives in
 * its own controller (NOT under the JwtAuthGuard'd TrackingController) and under
 * the `public/tracking` path so there is zero chance of inheriting an auth guard
 * or colliding with the guarded `:campaignId` routes.
 *
 * Because it is unauthenticated by design, it is the one route that is rate
 * limited: ThrottlerGuard + @Throttle cap requests per IP so the 43-char share
 * tokens can't be brute-forced/scraped at scale. Throttling is applied ONLY
 * here — the authenticated API is untouched.
 */
@ApiTags('Public Tracking')
@Controller('public/tracking')
@UseGuards(ThrottlerGuard)
export class PublicTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @ApiOperation({
    summary: 'Get a shared tracking report',
    description:
      'Public — no authentication required. Resolves a TrackingShareLink token (usable only while revokedAt is null and expiresAt is null or in the future). Rate limited to 30 requests/minute per IP.',
  })
  @ApiParam({ name: 'token', description: 'TrackingShareLink token (public lookup key, not the campaign id)' })
  @ApiResponse({ status: 200, description: 'Public tracking report.' })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  getPublicReport(@Param('token') token: string) {
    return this.tracking.getPublicReport(token);
  }
}
