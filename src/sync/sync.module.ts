import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { TtlService, INFLUENCER_SYNC_QUEUE } from './ttl.service';
import { SyncProcessor } from './sync.processor';
import { TikTokAdapter } from './adapters/tiktok.adapter';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { YouTubeAdapter } from './adapters/youtube.adapter';
import { PlatformConnectModule } from '../platform-connect/platform-connect.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: INFLUENCER_SYNC_QUEUE }),
    PrismaModule,
    PlatformConnectModule,
  ],
  providers: [
    TtlService,
    SyncProcessor,
    TikTokAdapter,
    InstagramAdapter,
    YouTubeAdapter,
  ],
  exports: [
    TtlService,
    BullModule,
    YouTubeAdapter,
    TikTokAdapter,
    InstagramAdapter,
  ],
})
export class SyncModule {}
