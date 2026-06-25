import {
  Body,
  Controller,
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

  @Post(':campaignId/results')
  recordResult(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
    @Body() dto: RecordResultDto,
  ) {
    return this.tracking.recordResult(req.user.userId, campaignId, dto);
  }
}
