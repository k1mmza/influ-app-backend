import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TrackingService } from './tracking.service';
import { RecordResultDto } from './dto/record-result.dto';
import { TrackingResultResponseDto } from './dto/tracking-result-response.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ShareLinkResponseDto } from '../common/dto/share-link-response.dto';

@ApiTags('Tracking')
@ApiBearerAuth('jwt')
@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  // ───────────────────────────────────────────────────────────────────────────
  // TEMPORARY OPS ENDPOINT — manual trigger for the YouTube tracking sync, so we
  // can run it once and inspect the TrackingResult rows it writes BEFORE any
  // @Cron is wired. NOT a user-facing feature; replace with a scheduled job
  // once the output is verified.
  //
  // This app has no ADMIN role (UserRole = BRAND | AGENCY | INFLUENCER), so
  // instead of @Roles it is gated by an env allowlist (ADMIN_EMAILS, comma-
  // separated) on top of JwtAuthGuard — i.e. NOT open to every brand/agency
  // user. An unset/empty allowlist denies everyone (safe default).
  // ───────────────────────────────────────────────────────────────────────────
  @ApiOperation({
    summary: 'Manually trigger the YouTube tracking sync',
    description:
      'Ops-only. Gated by an ADMIN_EMAILS env allowlist checked in the method body (not a @Roles decorator) — this app has no ADMIN role. An unset/empty allowlist denies everyone.',
  })
  @ApiResponse({ status: 201, description: 'Sync run, TrackingResult rows written.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller email is not in the ADMIN_EMAILS allowlist.', type: ErrorResponseDto })
  @Post('sync/youtube')
  syncYoutube(@Request() req: any) {
    const allow = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const email = (req.user?.email ?? '').toLowerCase();
    if (!email || !allow.includes(email)) {
      throw new ForbiddenException('Not authorized to trigger the sync');
    }
    return this.tracking.syncYoutubeStats();
  }

  @ApiOperation({ summary: 'Get tracking summary across the user\'s campaigns' })
  @ApiResponse({ status: 200, description: 'Summary payload.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Get()
  getSummary(@Request() req: any) {
    return this.tracking.getSummary(req.user.userId);
  }

  @ApiOperation({ summary: 'Get tracking detail for a campaign' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 200, description: 'Tracking detail, including TrackingResult rows.', type: [TrackingResultResponseDto] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Get(':campaignId')
  getDetail(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.tracking.getDetail(req.user.userId, campaignId);
  }

  // Client-facing presentation report for one campaign. Distinct path depth from
  // :campaignId above, so no route ambiguity. Same JwtAuthGuard as the rest —
  // the public "Share Report" link is a separate, not-yet-built epic.
  @ApiOperation({ summary: 'Get the client-facing tracking report for a campaign' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 200, description: 'Presentation report.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Get(':campaignId/report')
  getReport(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.tracking.getReport(req.user.userId, campaignId);
  }

  @ApiOperation({ summary: 'Record a tracking result snapshot' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 201, description: 'Snapshot recorded.', type: TrackingResultResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found, or submitted content not found for this campaign.', type: ErrorResponseDto })
  @Post(':campaignId/results')
  recordResult(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
    @Body() dto: RecordResultDto,
  ) {
    return this.tracking.recordResult(req.user.userId, campaignId, dto);
  }

  // ── Public "Share Report" link management (owner-only; the token they mint is
  // consumed by the UNGUARDED PublicTrackingController). Distinct path depths
  // from the report/results routes above, so no route ambiguity. ──────────────

  /** Mint a new public share link for this campaign. */
  @ApiOperation({ summary: 'Create a public tracking report share link', description: 'Owner-only. The token is consumed by the unauthenticated GET /public/tracking/:token.' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 201, description: 'Share link created.', type: ShareLinkResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Post(':campaignId/share')
  createShareLink(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
  ) {
    return this.tracking.createShareLink(req.user.userId, campaignId);
  }

  /** List the campaign's currently active (non-revoked, non-expired) links. */
  @ApiOperation({ summary: 'List active tracking share links', description: 'Owner-only. Only currently-usable links (revokedAt is null and expiresAt is null or in the future).' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 200, description: 'Active share links.', type: [ShareLinkResponseDto] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Get(':campaignId/share')
  listShareLinks(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.tracking.listShareLinks(req.user.userId, campaignId);
  }

  /** Revoke a single link by id (kills just that URL). */
  @ApiOperation({ summary: 'Revoke a tracking share link', description: 'Owner-only.' })
  @ApiParam({ name: 'linkId' })
  @ApiResponse({ status: 200, description: 'Link revoked.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Share link not found.', type: ErrorResponseDto })
  @Delete('share/:linkId')
  revokeShareLink(@Request() req: any, @Param('linkId') linkId: string) {
    return this.tracking.revokeShareLink(req.user.userId, linkId);
  }
}
