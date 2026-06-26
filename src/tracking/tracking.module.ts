import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { YouTubeStrategy } from '../platform-connect/strategies/youtube.strategy';
import { TikTokStrategy } from '../platform-connect/strategies/tiktok.strategy';
import { YoutubeSyncScheduler } from './youtube-sync.scheduler';
import { TiktokSyncScheduler } from './tiktok-sync.scheduler';

@Module({
  imports: [PrismaModule, CampaignsModule], // CampaignsService provides ownership checks
  controllers: [TrackingController],
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
