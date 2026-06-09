import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { TtlService, INFLUENCER_SYNC_QUEUE } from './ttl.service';
import { SyncProcessor } from './sync.processor';
import { TikTokAdapter } from './adapters/tiktok.adapter';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { YouTubeAdapter } from './adapters/youtube.adapter';

@Module({
  imports: [
    BullModule.registerQueue({ name: INFLUENCER_SYNC_QUEUE }),
    PrismaModule,
  ],
  providers: [
    TtlService,
    SyncProcessor,
    TikTokAdapter,
    InstagramAdapter,
    YouTubeAdapter,
  ],
  exports: [TtlService, BullModule, YouTubeAdapter],
})
export class SyncModule {}
