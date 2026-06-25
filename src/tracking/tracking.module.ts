import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { YouTubeStrategy } from '../platform-connect/strategies/youtube.strategy';
import { YoutubeSyncScheduler } from './youtube-sync.scheduler';

@Module({
  imports: [PrismaModule, CampaignsModule], // CampaignsService provides ownership checks
  controllers: [TrackingController],
  // YouTubeStrategy is a zero-dependency provider; the sync calls its
  // fetchVideoStats. Provided directly to avoid importing all of platform-connect.
  // YoutubeSyncScheduler is the daily @Cron wrapper (gated by YOUTUBE_SYNC_ENABLED).
  providers: [TrackingService, YouTubeStrategy, YoutubeSyncScheduler],
})
export class TrackingModule {}
