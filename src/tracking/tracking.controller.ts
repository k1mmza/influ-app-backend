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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TrackingService } from './tracking.service';
import { RecordResultDto } from './dto/record-result.dto';

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

  @Get()
  getSummary(@Request() req: any) {
    return this.tracking.getSummary(req.user.userId);
  }

  @Get(':campaignId')
  getDetail(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.tracking.getDetail(req.user.userId, campaignId);
  }

  // Client-facing presentation report for one campaign. Distinct path depth from
  // :campaignId above, so no route ambiguity. Same JwtAuthGuard as the rest —
  // the public "Share Report" link is a separate, not-yet-built epic.
  @Get(':campaignId/report')
  getReport(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.tracking.getReport(req.user.userId, campaignId);
  }

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
  @Post(':campaignId/share')
  createShareLink(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
  ) {
    return this.tracking.createShareLink(req.user.userId, campaignId);
  }

  /** List the campaign's currently active (non-revoked, non-expired) links. */
  @Get(':campaignId/share')
  listShareLinks(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.tracking.listShareLinks(req.user.userId, campaignId);
  }

  /** Revoke a single link by id (kills just that URL). */
  @Delete('share/:linkId')
  revokeShareLink(@Request() req: any, @Param('linkId') linkId: string) {
    return this.tracking.revokeShareLink(req.user.userId, linkId);
  }
}
