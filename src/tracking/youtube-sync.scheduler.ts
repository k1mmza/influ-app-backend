import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TrackingService } from './tracking.service';

/**
 * Thin scheduled wrapper around the already-working TrackingService.syncYoutube-
 * Stats(). No business logic here — it only decides *when* the sync runs and
 * whether it is allowed to run at all.
 *
 * Gated behind YOUTUBE_SYNC_ENABLED (default OFF): deploying this code does NOT
 * start writing to the shared DB on a timer. Enabling the cron is a deliberate
 * deploy-time choice (set YOUTUBE_SYNC_ENABLED=true).
 */
@Injectable()
export class YoutubeSyncScheduler {
  private readonly logger = new Logger(YoutubeSyncScheduler.name);

  constructor(private readonly tracking: TrackingService) {}

  // Daily at 03:00 UTC (low traffic). Snapshots are DAILY, so once a day is the
  // right cadence — the upsert key collapses repeat runs within the same day.
  @Cron('0 3 * * *', { name: 'youtube-tracking-sync', timeZone: 'UTC' })
  async handleDailySync(): Promise<void> {
    if (process.env.YOUTUBE_SYNC_ENABLED !== 'true') return;

    const { written, skipped } = await this.tracking.syncYoutubeStats();
    this.logger.log(
      `YouTube tracking sync complete: written=${written} skipped=${skipped}`,
    );
  }
}
