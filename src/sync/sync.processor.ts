import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TtlService, INFLUENCER_SYNC_QUEUE } from './ttl.service';
import { TikTokAdapter } from './adapters/tiktok.adapter';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { YouTubeAdapter } from './adapters/youtube.adapter';
import { PlatformAdapter } from './adapters/platform.adapter';
import { PlatformConnectService } from '../platform-connect/platform-connect.service';

export interface SyncJobData {
  influencerId: string;
  platform: string;
  handle: string;
}

@Processor(INFLUENCER_SYNC_QUEUE)
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);
  private readonly adapters: Map<string, PlatformAdapter>;

  constructor(
    private prisma: PrismaService,
    private ttl: TtlService,
    tiktok: TikTokAdapter,
    instagram: InstagramAdapter,
    youtube: YouTubeAdapter,
    @Optional() private platformConnect: PlatformConnectService,
  ) {
    super();
    this.adapters = new Map<string, PlatformAdapter>([
      ['tiktok', tiktok],
      ['instagram', instagram],
      ['youtube', youtube],
    ]);
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    const { influencerId, platform, handle } = job.data;
    this.logger.log(`Syncing ${platform}/@${handle} (${influencerId})`);

    await this.prisma.influencerProfile.update({
      where: { id: influencerId },
      data: { syncStatus: 'SYNCING' },
    });

    try {
      // For YouTube: prefer OAuth path when refresh token is available
      if (this.platformConnect) {
        const linked = await this.prisma.platformAccount.findFirst({
          where: { influencerId, platform: platform.toLowerCase(), refreshToken: { not: null } },
        });
        if (linked) {
          this.logger.log(`Using OAuth tokens for ${platform}/@${handle}`);
          await this.platformConnect.syncLinkedAccount(linked.id);
          this.logger.log(`OAuth sync done for ${platform}/@${handle}`);
          return;
        }
      }

      const adapter = this.adapters.get(platform.toLowerCase());
      if (!adapter) {
        this.logger.warn(`No adapter for platform: ${platform}`);
        return;
      }

      const profile = await adapter.fetchProfile(handle);
      if (!profile) {
        this.logger.warn(`Adapter returned null for ${platform}/@${handle} — API not wired yet`);
        return;
      }

      await this.prisma.platformAccount.updateMany({
        where: { influencerId, platform: platform.toLowerCase() },
        data: {
          followers: profile.followers,
          avgViews: profile.avgViews,
          engagementRate: profile.engagementRate,
          growthRate: profile.growthRate,
          profileUrl: profile.profileUrl,
          syncedAt: new Date(),
        },
      });

      this.logger.log(`Synced ${platform}/@${handle} successfully`);
    } finally {
      await this.ttl.updateNextRefresh(influencerId);
    }
  }
}
