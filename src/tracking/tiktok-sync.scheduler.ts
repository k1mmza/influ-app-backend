import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TrackingService } from './tracking.service';

/**
 * Thin scheduled wrapper around TrackingService.syncTiktokStats(), mirroring
 * YoutubeSyncScheduler. No business logic here — only when the sync runs and
 * whether it is allowed to run at all.
 *
 * Gated behind TIKTOK_SYNC_ENABLED (default OFF): deploying this code does NOT
 * start writing to the shared DB on a timer. Enabling the cron is a deliberate
 * deploy-time choice (set TIKTOK_SYNC_ENABLED=true).
 *
 * Runs 30 min after the YouTube sync so the two daily jobs don't overlap.
 */
@Injectable()
export class TiktokSyncScheduler {
  private readonly logger = new Logger(TiktokSyncScheduler.name);

  constructor(private readonly tracking: TrackingService) {}

  @Cron('30 3 * * *', { name: 'tiktok-tracking-sync', timeZone: 'UTC' })
  async handleDailySync(): Promise<void> {
    if (process.env.TIKTOK_SYNC_ENABLED !== 'true') return;

    const { written, skipped, reauth } = await this.tracking.syncTiktokStats();
    this.logger.log(
      `TikTok tracking sync complete: written=${written} skipped=${skipped} reauth=${reauth}`,
    );
  }
}
