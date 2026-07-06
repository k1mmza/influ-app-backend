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

  /**
   * Content-level platform, derived from the published contentUrl itself (never
   * the influencer's primary account, which can differ from where a given post
   * lives). parseVideoUrl authoritatively classifies YouTube/TikTok — including
   * TikTok short links, which still carry platform:'tiktok' even before the id
   * is resolved. For hosts it doesn't cover (e.g. Instagram), fall back to a
   * minimal hostname check so real posts aren't left blank. Unknown/unparseable
   * → null: an honest blank, never a misattributed platform.
   */
  private contentPlatform(contentUrl: string | null): string | null {
    if (!contentUrl) return null;
    // Authoritative when the URL carries a valid, sync-able video id.
    const parsed = parseVideoUrl(contentUrl);
    if (parsed) return parsed.platform;
    // parseVideoUrl is strict — it validates the video id for the sync pipeline,
    // so it rejects profile links or malformed ids even when the host makes the
    // platform obvious. For platform LABELLING we only need the host, so fall
    // back to a hostname check across the platforms the app uses. Unknown → null
    // (honest blank, never a misattribution).
    try {
      const host = new URL(contentUrl).hostname
        .replace(/^www\./, '')
        .toLowerCase();
      if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube';
      if (host.endsWith('tiktok.com')) return 'tiktok';
      if (host.endsWith('instagram.com')) return 'instagram';
      return null;
    } catch {
      return null;
    }
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

  /**
   * Client-facing campaign report (premium presentation page). Composes, in one
   * payload, everything the report page needs — reusing latestPerContent and the
   * same rollup math as getSummary WITHOUT forking it:
   *  - progress:  accepted deliverable slots vs. approved (published) content
   *  - summary:   total views + avg ER over SYNCED content (getSummary's math)
   *  - content[]: every SubmittedContent for the campaign, LEFT-joined to its
   *               latest TrackingResult snapshot (snap == null => not yet synced)
   *  - lastUpdated: most recent snapshot across the campaign, or null
   *
   * Growth % is intentionally omitted here and everywhere on the report: no
   * follower-history / delta tracking exists in this codebase, so any growth
   * number would be seeded-fake or 0. Pending a Phase 2 follow-up feature.
   */
  async getReport(userId: string, campaignId: string) {
    // Ownership + existence (throws NotFound if the user doesn't own it). Reuse
    // the returned campaign for name/status AND the accepted-slots count —
    // getCampaign already includes `applications`, so no extra query.
    const campaign = await this.campaigns.getCampaign(userId, campaignId);

    // Total Deliverables = ACCEPTED applications/invitations. An accepted invite
    // also terminates in status 'ACCEPTED', so this counts confirmed influencer
    // slots for either origin. This is the honest "target" (Campaign has no
    // stored target field) — deliberately NOT getSummary's influencerCount,
    // which counts influencers that already have tracking data. Matches the
    // ACCEPTED-count pattern used in dashboard.service.
    const totalDeliverables = campaign.applications.filter(
      (a) => a.status === 'ACCEPTED',
    ).length;

    // Every submitted content for this campaign (any review status) so the
    // report can render workflow status badges and "not yet synced" rows.
    const contents = await this.prisma.submittedContent.findMany({
      where: { application: { campaignId } },
      include: {
        application: {
          select: {
            influencer: {
              select: { user: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { reviewedAt: 'desc' },
    });

    // Latest snapshot per content. Ordered recordedAt desc so latestPerContent's
    // first-seen-wins dedup returns the newest, and snapshots[0] is the global
    // most-recent (drives lastUpdated).
    const snapshots = await this.prisma.trackingResult.findMany({
      where: { campaignId },
      orderBy: { recordedAt: 'desc' },
      select: {
        submittedContentId: true,
        views: true,
        likes: true,
        comments: true,
        shares: true,
        engagementRate: true,
        recordedAt: true,
      },
    });
    const synced = this.latestPerContent(snapshots);
    const byContent = new Map(synced.map((s) => [s.submittedContentId, s]));

    // Published = approved content. Rollup + averages over SYNCED content only,
    // mirroring getSummary (which aggregates the latest snapshot per content).
    const published = contents.filter(
      (c) => c.reviewStatus === 'APPROVED',
    ).length;
    const totalViews = synced.reduce((s, r) => s + r.views, 0);
    const sumEr = synced.reduce((s, r) => s + r.engagementRate, 0);
    const avgViews = synced.length ? totalViews / synced.length : 0;
    const avgErRaw = synced.length ? sumEr / synced.length : 0;
    // Rounded for display; badge comparisons use the unrounded avgErRaw.
    const avgEngagementRate = Number(avgErRaw.toFixed(1));

    // Badge thresholds — a REASONABLE DEFAULT, not a precise spec: compare each
    // synced item to the campaign's own averages. 'trending' = views above avg;
    // 'high_engagement' = ER above avg; 'above_average' = above on BOTH (emitted
    // alone to avoid three-badge noise).
    //
    // Suppressed entirely below MIN_FOR_BADGES synced items: with a single item
    // avg === value, so `> avg` never fires and `>= avg` always fires — the
    // badge would be meaningless either way.
    const MIN_FOR_BADGES = 2;
    const badgesEnabled = synced.length >= MIN_FOR_BADGES;

    const lastUpdated = snapshots.length ? snapshots[0].recordedAt : null;

    const content = contents.map((c) => {
      // Platform is CONTENT-level metadata: derive it from the post URL itself,
      // not the influencer's primary account (a creator's primary platform can
      // differ from where THIS post lives — using the account would misattribute
      // real content). See contentPlatform().
      const platform = this.contentPlatform(c.contentUrl);
      const snap = byContent.get(c.id) ?? null;

      let badges: string[] = [];
      if (badgesEnabled && snap) {
        const trending = snap.views > avgViews;
        const highEngagement = snap.engagementRate > avgErRaw;
        if (trending && highEngagement) {
          badges = ['above_average'];
        } else if (trending) {
          badges = ['trending'];
        } else if (highEngagement) {
          badges = ['high_engagement'];
        }
      }

      return {
        id: c.id,
        influencerName: c.application?.influencer?.user?.name ?? 'Unknown',
        platform,
        contentType: c.contentType,
        contentUrl: c.contentUrl,
        // Phase 2 real content metadata. All nullable — the UI falls back to its
        // Phase 1 placeholders (derived name / icon thumbnail / "Approved" date)
        // when a field is absent (non-synced content, Instagram, or TikTok
        // thumbnails which are deliberately not captured).
        title: c.title, // bridged from Draft.title (all approved content)
        thumbnailUrl: c.thumbnailUrl, // YouTube only for now
        publishedAt: c.publishedAt, // true on-platform publish date (YouTube/TikTok)
        // Raw workflow status; the UI maps it to Published/Reviewing/Draft.
        // No "Scheduled" — no such state exists in this codebase (adjustment #9:
        // derive from existing status, don't invent).
        status: c.reviewStatus,
        // reviewedAt = when the brand APPROVED. UI shows this ("Approved") only
        // as a fallback when publishedAt is null.
        approvedAt: c.reviewedAt,
        submittedAt: c.submittedAt,
        synced: snap != null,
        // null (not 0) when unsynced so the UI shows "Not yet synced" rather
        // than a fabricated zero.
        views: snap?.views ?? null,
        likes: snap?.likes ?? null,
        comments: snap?.comments ?? null,
        shares: snap?.shares ?? null,
        engagementRate: snap?.engagementRate ?? null,
        recordedAt: snap?.recordedAt ?? null,
        badges,
      };
    });

    const remaining = Math.max(0, totalDeliverables - published);
    // Clamp to [0,100]: one accepted influencer can publish MULTIPLE approved
    // posts, so published can exceed the accepted-slot count (deliverables) and
    // a raw ratio would read >100%. published/totalDeliverables stay raw for
    // transparency; only the completion percentage is capped for a sane bar.
    const pctComplete =
      totalDeliverables > 0
        ? Math.min(100, Math.round((published / totalDeliverables) * 100))
        : 0;

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        // Brand identity for the presentation header (real data via clientBrand).
        // logoUrl may be null — the UI falls back to brand initials, never a
        // broken <img>.
        brandName: campaign.clientBrand?.brandName ?? null,
        brandLogoUrl: campaign.clientBrand?.logoUrl ?? null,
        // "Campaign Duration" has no dedicated start/end fields. Use createdAt as
        // the honest start and submissionDate (planned content due date) as the
        // end when present; both are real. UI shows a range or "ongoing".
        startedAt: campaign.createdAt ?? null,
        submissionDate: campaign.submissionDate ?? null,
      },
      progress: { totalDeliverables, published, remaining, pctComplete },
      summary: { totalViews, avgEngagementRate, publishedPosts: published },
      lastUpdated,
      content,
    };
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
        // current metadata — used to write thumbnail/publishedAt once (only when
        // still null), never overwriting an already-captured value.
        thumbnailUrl: true,
        publishedAt: true,
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

      // Static per-content metadata (thumbnail + true publish date) lives on
      // SubmittedContent, NOT on the time-series TrackingResult. Write each field
      // only once — when still null — so a daily re-sync never overwrites a
      // captured value or churns the row.
      const meta: { thumbnailUrl?: string; publishedAt?: Date } = {};
      if (content.thumbnailUrl == null && stat.thumbnailUrl)
        meta.thumbnailUrl = stat.thumbnailUrl;
      if (content.publishedAt == null && stat.publishedAt)
        meta.publishedAt = new Date(stat.publishedAt);
      if (Object.keys(meta).length > 0) {
        await this.prisma.submittedContent.update({
          where: { id: content.id },
          data: meta,
        });
      }

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
        // for write-once of publishedAt (TikTok thumbnails are deliberately not
        // captured — see fetchVideoStats).
        publishedAt: true,
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
        {
          views: number;
          likes: number;
          comments: number;
          shares: number;
          publishedAt: string | null;
        }
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

        // Write-once the true publish date (thumbnail intentionally skipped for
        // TikTok — its cover URLs expire). Only when still null.
        if (content.publishedAt == null && stat.publishedAt) {
          await this.prisma.submittedContent.update({
            where: { id: content.id },
            data: { publishedAt: new Date(stat.publishedAt) },
          });
        }

        written++;
      }
    }

    return { written, skipped, reauth };
  }
}
