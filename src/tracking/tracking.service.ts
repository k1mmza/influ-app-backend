import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { YouTubeStrategy } from '../platform-connect/strategies/youtube.strategy';
import { parseVideoUrl } from '../sync/video-url';
import { RecordResultDto } from './dto/record-result.dto';

@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private campaigns: CampaignsService,
    private youtube: YouTubeStrategy,
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
    return this.recordSnapshot({
      campaignId,
      influencerId: content.application.influencerId,
      submittedContentId: content.id,
      views: dto.views,
      likes: dto.likes,
      comments: dto.comments,
      shares: dto.shares,
      engagementRate: dto.engagementRate,
      snapshotPeriod: dto.snapshotPeriod,
    });
  }

  /**
   * Canonical write for a tracking snapshot — the single place a TrackingResult
   * row is created. Pure write: callers are responsible for authorization and
   * for resolving a trusted (campaignId, influencerId, submittedContentId).
   * The HTTP path (recordResult) does ownership + server-derives influencerId;
   * platform sync adapters resolve their own ids and call this directly, so new
   * adapters slot in without a second write path.
   */
  async recordSnapshot(input: {
    campaignId: string;
    influencerId: string;
    submittedContentId: string;
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    engagementRate?: number;
    snapshotPeriod?: string;
    recordedAt?: Date;
  }) {
    const data = {
      campaignId: input.campaignId,
      influencerId: input.influencerId,
      submittedContentId: input.submittedContentId,
      views: input.views ?? 0,
      likes: input.likes ?? 0,
      comments: input.comments ?? 0,
      shares: input.shares ?? 0,
      engagementRate: input.engagementRate ?? 0,
      snapshotPeriod: input.snapshotPeriod,
      ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
    };

    // When the caller supplies the full natural key (recordedAt + a non-null
    // period), upsert so repeat writes within the same day collapse onto one
    // row via the (submittedContentId, recordedAt, snapshotPeriod) unique key —
    // this is the path the daily YouTube sync uses. Ad-hoc callers without that
    // key (e.g. manual HTTP entry, no period) just insert, as before.
    if (input.recordedAt && input.snapshotPeriod) {
      return this.prisma.trackingResult.upsert({
        where: {
          submittedContentId_recordedAt_snapshotPeriod: {
            submittedContentId: input.submittedContentId,
            recordedAt: input.recordedAt,
            snapshotPeriod: input.snapshotPeriod,
          },
        },
        create: data,
        update: {
          views: data.views,
          likes: data.likes,
          comments: data.comments,
          shares: data.shares,
          engagementRate: data.engagementRate,
        },
      });
    }

    return this.prisma.trackingResult.create({ data });
  }

  /**
   * Daily YouTube tracking sync. Ties together parseVideoUrl + the YouTube
   * strategy's batched fetchVideoStats + the single recordSnapshot writer.
   * Scans approved content on ACTIVE campaigns, pulls public stats for any
   * YouTube URLs, and upserts one DAILY snapshot per video (idempotent within
   * a day). Never writes TrackingResult except via recordSnapshot.
   */
  async syncYoutubeStats(): Promise<{ written: number; skipped: number }> {
    // Candidate content: approved work on ACTIVE campaigns. Status is a free
    // String, so match the literal exactly — no 'PUBLIC', no visibility filter.
    const candidates = await this.prisma.submittedContent.findMany({
      where: { application: { campaign: { status: 'ACTIVE' } } },
      select: {
        id: true,
        contentUrl: true,
        application: { select: { campaignId: true, influencerId: true } },
      },
    });

    // Keep only YouTube URLs; map videoId -> resolved content. Everything else
    // (TikTok/IG/Drive/garbage) is skipped.
    const byVideoId = new Map<string, (typeof candidates)[number]>();
    let skipped = 0;
    for (const c of candidates) {
      const parsed = parseVideoUrl(c.contentUrl);
      if (!parsed) {
        skipped++;
        continue;
      }
      byVideoId.set(parsed.videoId, c);
    }

    if (byVideoId.size === 0) return { written: 0, skipped };

    const stats = await this.youtube.fetchVideoStats([...byVideoId.keys()]);

    // Floor to today 00:00:00Z so the daily upsert key is stable within the day.
    const now = new Date();
    const recordedAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    let written = 0;
    for (const [videoId, content] of byVideoId) {
      const stat = stats.get(videoId);
      if (!stat) {
        // Deleted/private — absent from the fetch. Count as skipped, don't throw.
        skipped++;
        continue;
      }

      // ER stored as a percent (seed + page render `{engagementRate}%`); a raw
      // fraction would show synced rows 100x off. shares not exposed by the API.
      const engagementRate =
        stat.views > 0
          ? parseFloat(
              (((stat.likes + stat.comments) / stat.views) * 100).toFixed(2),
            )
          : 0;

      await this.recordSnapshot({
        campaignId: content.application.campaignId,
        influencerId: content.application.influencerId,
        submittedContentId: content.id,
        views: stat.views,
        likes: stat.likes,
        comments: stat.comments,
        shares: 0,
        engagementRate,
        snapshotPeriod: 'DAILY',
        recordedAt,
      });
      written++;
    }

    return { written, skipped };
  }
}
