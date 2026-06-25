import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { RecordResultDto } from './dto/record-result.dto';

@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private campaigns: CampaignsService,
  ) {}

  // TrackingResult is snapshot-based (many rows per content over time). For the
  // page we only care about the most recent snapshot per submitted content.
  private latestPerContent<T extends { submittedContentId: string }>(
    // input MUST be ordered by recordedAt desc so the first seen is the latest
    rows: T[],
  ): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const r of rows) {
      if (seen.has(r.submittedContentId)) continue;
      seen.add(r.submittedContentId);
      out.push(r);
    }
    return out;
  }

  /** Top table: every campaign the user owns + rolled-up performance. */
  async getSummary(userId: string) {
    const campaigns = await this.campaigns.getCampaignsForUser(userId);
    const campaignIds = campaigns.map((c) => c.id);

    const results = campaignIds.length
      ? await this.prisma.trackingResult.findMany({
          where: { campaignId: { in: campaignIds } },
          orderBy: { recordedAt: 'desc' },
          select: {
            campaignId: true,
            submittedContentId: true,
            influencerId: true,
            views: true,
            engagementRate: true,
          },
        })
      : [];

    return campaigns.map((c) => {
      const latest = this.latestPerContent(
        results.filter((r) => r.campaignId === c.id),
      );
      const totalViews = latest.reduce((s, r) => s + r.views, 0);
      const avgEngagementRate = latest.length
        ? latest.reduce((s, r) => s + r.engagementRate, 0) / latest.length
        : 0;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        influencerCount: new Set(latest.map((r) => r.influencerId)).size,
        totalViews,
        avgEngagementRate: Number(avgEngagementRate.toFixed(1)),
      };
    });
  }

  /** Detail table: per-influencer latest snapshot for one campaign. */
  async getDetail(userId: string, campaignId: string) {
    // ownership + existence — throws NotFound if the user doesn't own it
    await this.campaigns.getCampaign(userId, campaignId);

    const results = await this.prisma.trackingResult.findMany({
      where: { campaignId },
      orderBy: { recordedAt: 'desc' },
      include: {
        influencer: {
          select: {
            growthRate: true,
            user: { select: { name: true } },
            platformAccounts: {
              select: { platform: true, isPrimary: true },
            },
          },
        },
        submittedContent: { select: { contentType: true, contentUrl: true } },
      },
    });

    return this.latestPerContent(results).map((r) => {
      const accounts = r.influencer?.platformAccounts ?? [];
      const platform =
        accounts.find((a) => a.isPrimary)?.platform ??
        accounts[0]?.platform ??
        null;
      return {
        id: r.id,
        influencerName: r.influencer?.user?.name ?? 'Unknown',
        platform,
        contentType: r.submittedContent?.contentType ?? null,
        contentUrl: r.submittedContent?.contentUrl ?? null,
        views: r.views,
        likes: r.likes,
        comments: r.comments,
        shares: r.shares,
        engagementRate: r.engagementRate,
        growthRate: r.influencer?.growthRate ?? 0,
        recordedAt: r.recordedAt,
      };
    });
  }

  /** Record a new performance snapshot for a piece of submitted content. */
  async recordResult(userId: string, campaignId: string, dto: RecordResultDto) {
    await this.campaigns.getCampaign(userId, campaignId); // ownership

    const content = await this.prisma.submittedContent.findUnique({
      where: { id: dto.submittedContentId },
      include: { application: { select: { campaignId: true, influencerId: true } } },
    });
    if (!content || content.application.campaignId !== campaignId) {
      throw new NotFoundException('Submitted content not found for this campaign');
    }

    // influencerId is taken from the content's application — never trusted from the client
    return this.prisma.trackingResult.create({
      data: {
        campaignId,
        influencerId: content.application.influencerId,
        submittedContentId: content.id,
        views: dto.views ?? 0,
        likes: dto.likes ?? 0,
        comments: dto.comments ?? 0,
        shares: dto.shares ?? 0,
        engagementRate: dto.engagementRate ?? 0,
        snapshotPeriod: dto.snapshotPeriod,
      },
    });
  }
}
