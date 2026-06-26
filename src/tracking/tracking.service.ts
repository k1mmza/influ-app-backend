import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { YouTubeStrategy } from '../platform-connect/strategies/youtube.strategy';
import {
  TikTokStrategy,
  TikTokAuthError,
} from '../platform-connect/strategies/tiktok.strategy';
import { parseVideoUrl } from '../sync/video-url';
import { RecordResultDto } from './dto/record-result.dto';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private prisma: PrismaService,
    private campaigns: CampaignsService,
    private youtube: YouTubeStrategy,
    private tiktok: TikTokStrategy,
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
      include: {
        application: { select: { campaignId: true, influencerId: true } },
      },
    });
    if (!content || content.application.campaignId !== campaignId) {
      throw new NotFoundException(
        'Submitted content not found for this campaign',
      );
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
      // parseVideoUrl now also resolves TikTok; this sync is YouTube-only, so
      // anything that isn't a YouTube id is not ours — skip it (TikTok content
      // is handled by syncTiktokStats).
      if (!parsed || parsed.platform !== 'youtube') {
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

  /** Mark a connected account as needing re-consent (revoked token or missing
   *  video.list scope) so the UI can prompt the influencer to reconnect. Best
   *  effort — a failure here must never break the sync loop. */
  private async flagReauth(platformAccountId: string): Promise<void> {
    try {
      await this.prisma.platformAccount.update({
        where: { id: platformAccountId },
        data: { needsReauth: true },
      });
    } catch (e: any) {
      this.logger.warn(
        `Could not set needsReauth on account ${platformAccountId}: ${e.message}`,
      );
    }
  }

  /**
   * Daily TikTok tracking sync. Mirrors syncYoutubeStats, but TikTok has no
   * public stats-by-id endpoint: /v2/video/query/ only returns videos owned by
   * the user whose OAuth token we hold. So candidates are GROUPED BY INFLUENCER
   * and fetched with that influencer's token (refreshing it first if expired).
   *
   * Degrades exactly like the YouTube pipeline — it NEVER throws. Per-influencer
   * failures (no connected TikTok, revoked/expired refresh token, missing
   * video.list scope) skip that influencer's content and set needsReauth on
   * their PlatformAccount so the UI can prompt re-consent. Writes go only
   * through recordSnapshot (untouched). Returns counts plus how many influencers
   * were flagged for re-auth.
   */
  async syncTiktokStats(): Promise<{
    written: number;
    skipped: number;
    reauth: number;
  }> {
    const candidates = await this.prisma.submittedContent.findMany({
      where: { application: { campaign: { status: 'ACTIVE' } } },
      select: {
        id: true,
        contentUrl: true,
        application: { select: { campaignId: true, influencerId: true } },
      },
    });

    // Group resolvable TikTok videos by influencer (each needs that
    // influencer's token). Non-TikTok URLs, and TikTok short links we can't
    // resolve purely (needsResolution), count as skipped — same as YouTube.
    const byInfluencer = new Map<
      string,
      { videoId: string; content: (typeof candidates)[number] }[]
    >();
    let skipped = 0;
    for (const c of candidates) {
      const parsed = parseVideoUrl(c.contentUrl);
      if (!parsed || parsed.platform !== 'tiktok' || parsed.videoId === null) {
        skipped++;
        continue;
      }
      const influencerId = c.application.influencerId;
      const list = byInfluencer.get(influencerId) ?? [];
      list.push({ videoId: parsed.videoId, content: c });
      byInfluencer.set(influencerId, list);
    }

    if (byInfluencer.size === 0) return { written: 0, skipped, reauth: 0 };

    // Floor to today 00:00:00Z so the daily upsert key is stable within the day.
    const now = new Date();
    const recordedAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    let written = 0;
    let reauth = 0;

    for (const [influencerId, items] of byInfluencer) {
      const account = await this.prisma.platformAccount.findFirst({
        where: { influencerId, platform: 'tiktok' },
      });

      // No connected TikTok (or no usable tokens) — can't fetch. Skip this
      // influencer's content; flag the account if one exists so the UI prompts
      // a (re)connect. Never throw.
      if (!account || !account.accessToken || !account.refreshToken) {
        skipped += items.length;
        if (account) {
          await this.flagReauth(account.id);
          reauth++;
        }
        continue;
      }

      // Refresh an expired/near-expiry token, mirroring PlatformConnectService.
      // A failed refresh means the refresh token is revoked/expired -> re-auth.
      let accessToken = account.accessToken;
      const fiveMin = new Date(Date.now() + 5 * 60 * 1000);
      if (!account.tokenExpiry || account.tokenExpiry < fiveMin) {
        try {
          const refreshed = await this.tiktok.refreshAccessToken(
            account.refreshToken,
          );
          accessToken = refreshed.accessToken;
          await this.prisma.platformAccount.update({
            where: { id: account.id },
            data: {
              accessToken: refreshed.accessToken,
              tokenExpiry: refreshed.expiry,
              needsReauth: false,
            },
          });
        } catch (e: any) {
          this.logger.warn(
            `TikTok token refresh failed for account ${account.id}: ${e.message}`,
          );
          skipped += items.length;
          await this.flagReauth(account.id);
          reauth++;
          continue;
        }
      }

      // Fetch this influencer's video stats. A hard auth/scope failure
      // (TikTokAuthError) means the token can't read videos -> re-auth. Any
      // other unexpected error also degrades to skip-and-flag, never throw.
      let stats: Map<
        string,
        { views: number; likes: number; comments: number; shares: number }
      >;
      try {
        stats = await this.tiktok.fetchVideoStats(
          accessToken,
          items.map((i) => i.videoId),
        );
      } catch (e: any) {
        const why =
          e instanceof TikTokAuthError ? 'auth/scope' : `error: ${e.message}`;
        this.logger.warn(
          `TikTok video.query failed for account ${account.id} (${why})`,
        );
        skipped += items.length;
        await this.flagReauth(account.id);
        reauth++;
        continue;
      }

      // Reached the API successfully — clear a stale needsReauth flag if set.
      if (account.needsReauth) {
        await this.prisma.platformAccount.update({
          where: { id: account.id },
          data: { needsReauth: false },
        });
      }

      for (const { videoId, content } of items) {
        const stat = stats.get(videoId);
        if (!stat) {
          // Deleted/private/not-owned — absent from the fetch. Skip, don't throw.
          skipped++;
          continue;
        }

        // ER stored as a percent (seed + page render `{engagementRate}%`).
        // TikTok exposes shares, so engagement includes them (matches the
        // TikTok discovery adapter's convention); shares is a real value here.
        const engagementRate =
          stat.views > 0
            ? parseFloat(
                (
                  ((stat.likes + stat.comments + stat.shares) / stat.views) *
                  100
                ).toFixed(2),
              )
            : 0;

        await this.recordSnapshot({
          campaignId: content.application.campaignId,
          influencerId: content.application.influencerId,
          submittedContentId: content.id,
          views: stat.views,
          likes: stat.likes,
          comments: stat.comments,
          shares: stat.shares,
          engagementRate,
          snapshotPeriod: 'DAILY',
          recordedAt,
        });
        written++;
      }
    }

    return { written, skipped, reauth };
  }
}
