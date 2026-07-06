import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TrackingController } from './tracking.controller';
import { PublicTrackingController } from './public-tracking.controller';
import { TrackingService } from './tracking.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { YouTubeStrategy } from '../platform-connect/strategies/youtube.strategy';
import { TikTokStrategy } from '../platform-connect/strategies/tiktok.strategy';
import { YoutubeSyncScheduler } from './youtube-sync.scheduler';
import { TiktokSyncScheduler } from './tiktok-sync.scheduler';

@Module({
  imports: [
    PrismaModule,
    CampaignsModule, // CampaignsService provides ownership checks
    // Rate-limit config for the ThrottlerGuard applied ONLY on the public report
    // route (see PublicTrackingController). Registering forRoot here rather than
    // in AppModule keeps throttling scoped to this module's public endpoint —
    // the rest of the authenticated API is deliberately not throttled.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
  ],
  controllers: [TrackingController, PublicTrackingController],
  // YouTube/TikTok strategies are zero-dependency providers; the syncs call
  // their fetchVideoStats. Provided directly to avoid importing all of
  // platform-connect. The schedulers are the daily @Cron wrappers (each gated
  // by its own *_SYNC_ENABLED env flag).
  providers: [
    TrackingService,
    YouTubeStrategy,
    TikTokStrategy,
    YoutubeSyncScheduler,
    TiktokSyncScheduler,
  ],
})
export class TrackingModule {}
