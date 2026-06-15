import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TtlService, INFLUENCER_SYNC_QUEUE } from '../sync/ttl.service';
import { SyncJobData } from '../sync/sync.processor';
import { YouTubeAdapter } from '../sync/adapters/youtube.adapter';
import { TikTokAdapter } from '../sync/adapters/tiktok.adapter';
import { InstagramAdapter } from '../sync/adapters/instagram.adapter';
import { PlatformProfile, PostEngagement } from '../sync/adapters/platform.adapter';
import { AiAnalysisService, AiChannelAnalysis } from './ai-analysis.service';
import { SmartSearchService } from './smart-search.service';

@Injectable()
export class InfluencersService {
  private readonly logger = new Logger(InfluencersService.name);

  constructor(
    private prisma: PrismaService,
    private ttl: TtlService,
    @InjectQueue(INFLUENCER_SYNC_QUEUE) private syncQueue: Queue<SyncJobData>,
    private youtube: YouTubeAdapter,
    private tiktok: TikTokAdapter,
    private instagram: InstagramAdapter,
    private aiAnalysis: AiAnalysisService,
    private smartSearch: SmartSearchService,
  ) {}

  async findAll(query: any) {
    if (query.q) {
      const aiFilters = await this.smartSearch.parseQuery(query.q);
      // Map AI categories array → categories query param
      if (aiFilters.categories?.length && !query.categories) {
        query.categories = aiFilters.categories.join(',');
      }
      // Map AI platforms array → single platform string
      if ((aiFilters as any).platforms?.length && !query.platform) {
        (aiFilters as any).platform = (aiFilters as any).platforms.join(',').toLowerCase();
      }
      // Merge AI filters with explicit query params (explicit take priority)
      query = { ...aiFilters, ...query, q: undefined };
      if (!query.platform && query.platforms) {
        query.platform = Array.isArray(query.platforms)
          ? query.platforms.join(',')
          : query.platforms;
      }
    }

    const {
      categories: categoriesParam,
      platform,
      followerRange,
      minAverageViews,
      minEngagementRate,
      minGrowthRate,
      keyword,
      minQualityScore,
      minPerformanceScore,
      maxRatePerPost,
      minRatePerPost,
      minFollowers,
      minResponseRate,
      stylePresent,
      availabilityStatus,
      country,
    } = query;

    const where: any = {};
    const andConditions: any[] = [];

    // ── Categories ───────────────────────────────────────────────────────────
    if (categoriesParam) {
      const categoryList = (categoriesParam as string)
        .split(',')
        .map((c: string) => c.trim().toLowerCase())
        .filter(Boolean);
        
      if (categoryList.length === 1) {
        where.categories = { array_contains: categoryList[0] };
      } else if (categoryList.length > 1) {
        andConditions.push({
          OR: categoryList.map((cat: string) => ({
            categories: { array_contains: cat },
          })),
        });
      }
    }

    // ── Platform accounts (all filters merged into one `some` clause) ────────
    const platformAccountFilter: any = {};

    if (platform && platform !== 'All') {
      const platformList = (platform as string)
        .split(',')
        .map((p: string) => p.trim().toLowerCase())
        .filter(Boolean);
      if (platformList.length === 1) {
        platformAccountFilter.platform = { 
          equals: platformList[0], 
          mode: 'insensitive' 
        };
      } else if (platformList.length > 1) {
        andConditions.push({
          // Prisma's 'in' operator doesn't natively support mode: 'insensitive'. 
          // Using an OR array ensures it works regardless of database casing.
          OR: platformList.map((p) => ({
            platformAccounts: { 
              some: { platform: { equals: p, mode: 'insensitive' } } 
            }
          }))
        });
      }
    }

    if (followerRange && followerRange !== 'All') {
      const ranges: any = {
        Nano:  { min: 1_000,   max: 10_000 },
        Micro: { min: 10_000,  max: 100_000 },
        Mid:   { min: 100_000, max: 500_000 },
        Macro: { min: 500_000, max: 1_000_000 },
        Mega:  { min: 1_000_000 },
      };
      const range = ranges[followerRange];
      if (range) {
        platformAccountFilter.followers = {
          gte: range.min,
          ...(range.max ? { lte: range.max } : {}),
        };
      }
    }

    const parsedMinFollowers = parseInt(minFollowers, 10);
    if (!isNaN(parsedMinFollowers) && parsedMinFollowers > 0) {
      platformAccountFilter.followers = {
        ...(platformAccountFilter.followers || {}),
        gte: parsedMinFollowers,
      };
    }

    const parsedEngagementRate = parseFloat(minEngagementRate);
    if (!isNaN(parsedEngagementRate) && parsedEngagementRate > 0) {
      platformAccountFilter.engagementRate = { gte: parsedEngagementRate };
    }

    const parsedAvgViews = parseInt(minAverageViews, 10);
    if (!isNaN(parsedAvgViews) && parsedAvgViews > 0) {
      platformAccountFilter.avgViews = { gte: parsedAvgViews };
    }

    if (Object.keys(platformAccountFilter).length > 0) {
      where.platformAccounts = { some: platformAccountFilter };
    }

    // ── Keyword ──────────────────────────────────────────────────────────────
    if (keyword) {
      andConditions.push({
        OR: [
          { bio: { contains: keyword, mode: 'insensitive' } },
          { user: { name: { contains: keyword, mode: 'insensitive' } } },
          // string_contains here too — consistent with category filter
          { categories: { array_contains: keyword } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    // ── Profile-level numeric filters ────────────────────────────────────────
    const parsedQualityScore = parseFloat(minQualityScore);
    if (!isNaN(parsedQualityScore) && parsedQualityScore > 0) {
      where.qualityScore = { gte: parsedQualityScore };
    }

    const parsedPerformanceScore = parseFloat(minPerformanceScore);
    if (!isNaN(parsedPerformanceScore) && parsedPerformanceScore > 0) {
      where.performanceScore = { gte: parsedPerformanceScore };
    }

    const parsedGrowthRate = parseFloat(minGrowthRate);
    if (!isNaN(parsedGrowthRate) && parsedGrowthRate > 0) {
      where.growthRate = { gte: parsedGrowthRate };
    }

    const parsedResponseRate = parseFloat(minResponseRate);
    if (!isNaN(parsedResponseRate) && parsedResponseRate > 0) {
      where.responseRate = { gte: parsedResponseRate };
    }

    // ── Rate card ────────────────────────────────────────────────────────────
    const parsedMinRate = parseFloat(minRatePerPost);
    const parsedMaxRate = parseFloat(maxRatePerPost);
    const hasMinRate = !isNaN(parsedMinRate) && parsedMinRate > 0;
    const hasMaxRate = !isNaN(parsedMaxRate) && parsedMaxRate > 0;
    if (hasMinRate || hasMaxRate) {
      const priceCondition: any = {};
      if (hasMinRate) priceCondition.gte = parsedMinRate;
      if (hasMaxRate) priceCondition.lte = parsedMaxRate;
      where.rateCards = { some: { pricePerPost: priceCondition } };
    }

    // ── Style / availability / country ───────────────────────────────────────
    if (stylePresent && stylePresent !== 'All') {
      where.styleTags = { array_contains: stylePresent.toLowerCase() };
    }

    if (availabilityStatus && availabilityStatus !== 'All') {
      where.availabilityStatus = availabilityStatus;
    }

    if (country) {
      where.country = { equals: country, mode: 'insensitive' };
    }

    const influencers = await this.prisma.influencerProfile.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        platformAccounts: true,
      },
    });

    return influencers.map((inf) => this.formatInfluencer(inf));
  }

  // ── Score helpers ─────────────────────────────────────────────────────────

  private readonly ER_BENCHMARK: Record<string, number> = {
    tiktok: 6, instagram: 3, youtube: 3, facebook: 1, x: 0.5, lemon8: 4,
  };

  private benchmarkFor(platform: string): number {
    return this.ER_BENCHMARK[platform.toLowerCase()] ?? 4;
  }

  private computeQualityScore(er: number, avgViews: number, followers: number, platform: string): number {
    const benchmark = this.benchmarkFor(platform);
    const erScore = Math.min(60, Math.round((er / Math.max(benchmark, 0.1)) * 60));
    const viewRatio = followers > 0 ? avgViews / followers : 0;
    const viewScore = Math.min(40, Math.round(viewRatio * 200));
    return erScore + viewScore;
  }

  private computePerformanceScore(
    er: number,
    avgViews: number,
    followers: number,
    platform: string,
    growthRate: number,
    qualityScore: number,
  ): number {
    const benchmark = this.benchmarkFor(platform);
    const engagementQuality = Math.min(100, Math.round((er / Math.max(benchmark, 0.1)) * 100));
    const growthQuality = Math.min(100, Math.round((growthRate / 20) * 100));
    const consistencyQuality = Math.min(100, Math.round((followers > 0 ? avgViews / followers : 0) * 300));
    return Math.min(
      100,
      Math.round(
        engagementQuality * 0.30 +
        qualityScore      * 0.30 +
        growthQuality     * 0.25 +
        consistencyQuality * 0.15,
      ),
    );
  }

  private computeScores(accounts: any[], growthRate: number): { qualityScore: number; performanceScore: number } {
    if (!accounts.length) return { qualityScore: 0, performanceScore: 0 };
    const main = accounts.reduce((a, b) => (a.followers > b.followers ? a : b), accounts[0]);
    const er = main.engagementRate ?? 0;
    const avgViews = main.avgViews ?? 0;
    const followers = Math.max(main.followers ?? 0, 1);
    const platform = main.platform ?? '';
    const qualityScore = this.computeQualityScore(er, avgViews, followers, platform);
    const performanceScore = this.computePerformanceScore(er, avgViews, followers, platform, growthRate ?? 0, qualityScore);
    return { qualityScore, performanceScore };
  }

  /**
   * Audience Authenticity Score (0–100)
   * Signals: comment-to-like ratio (30) + ER vs benchmark (30) + view/follower ratio (20) + like variance (20)
   */
  private computeAudienceQualityScore(
    posts: PostEngagement[],
    er: number,
    platform: string,
    avgViews: number,
    followers: number,
  ): number {
    const benchmark = this.benchmarkFor(platform);

    // 1. Comment-to-like ratio (30pts) — bots like but rarely comment
    let commentScore = 10; // neutral default when no data
    if (posts.length > 0) {
      const avgLikes = posts.reduce((s, p) => s + p.likes, 0) / posts.length;
      const avgComments = posts.reduce((s, p) => s + p.comments, 0) / posts.length;
      const ratio = avgLikes > 0 ? avgComments / avgLikes : 0;
      if (ratio >= 0.05) commentScore = 30;       // >5%: very authentic
      else if (ratio >= 0.02) commentScore = 22;  // 2-5%: normal
      else if (ratio >= 0.005) commentScore = 12; // 0.5-2%: below avg
      else if (ratio >= 0.001) commentScore = 5;  // <0.5%: suspicious
      else commentScore = 0;
    }

    // 2. ER vs benchmark (30pts) — low ER vs peers = inflated followers
    const erScore = Math.min(30, Math.round((er / Math.max(benchmark, 0.1)) * 30));

    // 3. View-to-follower ratio (20pts) — fake followers don't watch
    const viewRatio = followers > 0 ? avgViews / followers : 0;
    const viewScore = Math.min(20, Math.round(viewRatio * 100));

    // 4. Like variance (20pts) — uniform likes = purchased; natural variance = organic
    let varianceScore = 10; // neutral default
    if (posts.length >= 3) {
      const likes = posts.map((p) => p.likes);
      const mean = likes.reduce((s, l) => s + l, 0) / likes.length;
      if (mean > 0) {
        const stdDev = Math.sqrt(likes.reduce((s, l) => s + (l - mean) ** 2, 0) / likes.length);
        const cv = stdDev / mean;
        if (cv >= 0.5) varianceScore = 20;
        else if (cv >= 0.3) varianceScore = 15;
        else if (cv >= 0.15) varianceScore = 10;
        else if (cv >= 0.05) varianceScore = 5;
        else varianceScore = 0;
      }
    }

    return Math.min(100, commentScore + erScore + viewScore + varianceScore);
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  private formatInfluencer(inf: any) {
    // Stub for async Apify fetch in progress
    if (inf.isExternal && inf.syncStatus === 'SYNCING' && !inf.platformAccounts?.length) {
      return {
        id: inf.id,
        handle: inf.externalHandle ?? null,
        name: inf.externalHandle ?? 'Loading...',
        platforms: [],
        followers: 0,
        followersByPlatform: {},
        avgViewsByPlatform: {},
        engagementRate: 0,
        category: 'Lifestyle',
        performanceScore: 0,
        ratePerPost: 0,
        stylePresent: [],
        avatarUrl: null,
        spotlightVideo: null,
        syncStatus: 'SYNCING',
        rateCardFileUrl: null,
        meta: { country: null, city: null, audienceCountryPercent: null, averageViews: 0, growthRate: 0, qualityScore: 0, responseRate: 0, bio: null },
      };
    }

    const accounts = inf.platformAccounts ?? [];
    const mainAccount = accounts.length
      ? accounts.reduce((prev, current) =>
          prev.followers > current.followers ? prev : current
        )
      : null;

    const { qualityScore, performanceScore } = this.computeScores(accounts, inf.growthRate ?? 0);

    const spotlightVideo = mainAccount?.spotlightVideoId
      ? {
          id: mainAccount.spotlightVideoId,
          title: mainAccount.spotlightVideoTitle || '',
          thumbnail: mainAccount.spotlightThumbnailUrl
            || (mainAccount.platform === 'youtube'
              ? `https://img.youtube.com/vi/${mainAccount.spotlightVideoId}/hqdefault.jpg`
              : ''),
        }
      : null;

    return {
      id: inf.id,
      handle: mainAccount?.handle ?? null,
      name: inf.user?.name || mainAccount?.displayName || 'Unknown',
      platforms: accounts.map((p) => p.platform),
      followers: mainAccount?.followers ?? 0,
      followersByPlatform: accounts.reduce((acc, p) => ({ ...acc, [p.platform]: p.followers }), {}),
      avgViewsByPlatform: accounts.reduce((acc, p) => ({ ...acc, [p.platform]: p.avgViews }), {}),
      engagementRate: mainAccount?.engagementRate ?? 0,
      category: Array.isArray(inf.categories) ? inf.categories[0] : (inf.categories || 'lifestyle'),
      performanceScore,
      ratePerPost: 0,
      stylePresent: Array.isArray(inf.styleTags) ? inf.styleTags : [],
      avatarUrl: mainAccount?.avatarUrl ?? null,
      spotlightVideo,
      syncStatus: inf.syncStatus ?? 'IDLE',
      rateCardFileUrl: inf.rateCardFileUrl ?? null,
      meta: {
        country: inf.country ?? null,
        city: null,
        audienceCountryPercent: null,
        averageViews: mainAccount?.avgViews ?? 0,
        growthRate: inf.growthRate ?? 0,
        qualityScore,
        audienceQualityScore: inf.audienceQualityScore ?? null,
        responseRate: inf.responseRate ?? 0,
        bio: inf.bio ?? null,
      },
    };
  }

  async findOne(id: string) {
    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { id },
      include: { user: true, platformAccounts: true, rateCards: true },
    });
    return influencer ? this.formatInfluencer(influencer) : null;
  }

  async getClaimCandidates(influencerId: string): Promise<any[]> {
    const accounts = await this.prisma.platformAccount.findMany({
      where: { influencerId },
    });
    if (!accounts.length) return [];

    const candidates = await Promise.all(
      accounts.map((acc) =>
        this.prisma.platformAccount.findMany({
          where: {
            platform: { equals: acc.platform, mode: 'insensitive' },
            handle: { equals: acc.handle, mode: 'insensitive' },
            influencer: { isExternal: true, claimed: false },
            influencerId: { not: influencerId },
          },
          include: {
            influencer: {
              include: {
                user: { select: { name: true } },
                platformAccounts: true,
              },
            },
          },
        }),
      ),
    );

    const seen = new Set<string>();
    return candidates
      .flat()
      .map((a) => a.influencer)
      .filter((inf) => {
        if (seen.has(inf.id)) return false;
        seen.add(inf.id);
        return true;
      })
      .map((inf) => this.formatInfluencer(inf));
  }

  async claimProfile(externalInfluencerId: string, claimerInfluencerId: string): Promise<void> {
    const [external, claimer] = await Promise.all([
      this.prisma.influencerProfile.findUnique({
        where: { id: externalInfluencerId },
        include: { platformAccounts: true },
      }),
      this.prisma.influencerProfile.findUnique({
        where: { id: claimerInfluencerId },
        include: { user: true, platformAccounts: true },
      }),
    ]);

    if (!external || !claimer) throw new Error('Profile not found');
    if (!external.isExternal) throw new Error('Target is not an external profile');
    if (external.claimed) throw new Error('Profile already claimed');

    const claimerHandles = new Set(
      claimer.platformAccounts.map((a) => `${a.platform}:${a.handle.toLowerCase()}`),
    );
    const accountsToTransfer = external.platformAccounts.filter(
      (a) => !claimerHandles.has(`${a.platform}:${a.handle.toLowerCase()}`),
    );

    await this.prisma.$transaction([
      ...accountsToTransfer.map((a) =>
        this.prisma.platformAccount.update({
          where: { id: a.id },
          data: { influencerId: claimerInfluencerId },
        }),
      ),
      this.prisma.profileEvent.updateMany({
        where: { influencerId: externalInfluencerId },
        data: { influencerId: claimerInfluencerId },
      }),
      this.prisma.influencerProfile.update({
        where: { id: externalInfluencerId },
        data: { claimed: true, claimedByUserId: claimer.userId },
      }),
      this.prisma.influencerProfile.update({
        where: { id: claimerInfluencerId },
        data: {
          bio: claimer.bio ?? external.bio ?? undefined,
          categories: (claimer.categories ?? external.categories ?? undefined) as any,
          growthRate: claimer.growthRate ?? external.growthRate ?? undefined,
        },
      }),
    ]);
  }

  async lookupByHandle(
    platform: string,
    handle: string,
  ): Promise<{ found: boolean; source?: 'db' | 'api'; loading?: boolean; influencer?: any }> {
    await this.ttl.recordEvent('', 'SEARCH').catch(() => {});
    const cleanHandle = handle.replace(/^@/, '');

    const account = await this.prisma.platformAccount.findFirst({
      where: {
        platform: { equals: platform.toLowerCase(), mode: 'insensitive' },
        handle: { equals: cleanHandle, mode: 'insensitive' },
      },
      include: {
        influencer: {
          include: {
            user: { select: { name: true, email: true } },
            platformAccounts: true,
          },
        },
      },
    });

    if (account) {
      const influencer = account.influencer;
      // Still loading from a previous async fetch
      if (influencer.syncStatus === 'SYNCING') {
        return { found: true, source: 'db' as const, loading: true, influencer: this.formatInfluencer(influencer) };
      }
      await this.ttl.recordEvent(influencer.id, 'SEARCH');
      const shouldSync = await this.ttl.checkAndFlag(influencer.id);
      if (shouldSync) {
        await this.prisma.influencerProfile.update({
          where: { id: influencer.id },
          data: { syncStatus: 'SYNCING' },
        });
        await this.syncQueue.add('sync', {
          influencerId: influencer.id,
          platform: platform.toLowerCase(),
          handle: cleanHandle,
        });
      }
      return { found: true, source: 'db' as const, influencer: this.formatInfluencer(influencer) };
    }

    const p = platform.toLowerCase();

    // YouTube is fast — keep synchronous
    if (p === 'youtube') {
      const profile = await this.youtube.fetchProfile(cleanHandle);
      if (profile) {
        const aiData = await this.aiAnalysis.analyzeYouTubeChannel(
          profile.displayName, profile.bio, profile.topVideoIds ?? [], profile.videoTitles ?? [],
        );
        return this.saveAndReturnExternalProfile(profile, p, cleanHandle, aiData);
      }
      return { found: false };
    }

    // TikTok / Instagram — create stub immediately, fetch in background
    if (p === 'tiktok' || p === 'instagram') {
      const stub = await this.prisma.influencerProfile.create({
        data: {
          isExternal: true,
          externalHandle: cleanHandle,
          syncStatus: 'SYNCING',
          lastSyncedAt: new Date(),
          nextRefreshAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          platformAccounts: {
            create: { platform: p, handle: cleanHandle, displayName: cleanHandle },
          },
        },
        include: { platformAccounts: true, user: { select: { name: true, email: true } } },
      });
      this.fetchAndUpdateProfile(stub.id, p, cleanHandle).catch(() => {});
      return { found: true, source: 'api' as const, loading: true, influencer: this.formatInfluencer(stub) };
    }

    return { found: false };
  }

  private async fetchAndUpdateProfile(profileId: string, platform: string, handle: string): Promise<void> {
    try {
      let profile: PlatformProfile | null = null;
      let aiData: AiChannelAnalysis | null = null;

      if (platform === 'tiktok') {
        profile = await this.tiktok.fetchProfile(handle);
        if (profile) {
          aiData = await this.aiAnalysis.analyzeProfile('TikTok', profile.displayName, profile.bio, profile.videoTitles ?? []);
        }
      } else if (platform === 'instagram') {
        profile = await this.instagram.fetchProfile(handle);
        if (profile) {
          aiData = await this.aiAnalysis.analyzeProfile('Instagram', profile.displayName, profile.bio, profile.videoTitles ?? []);
        }
      }

      if (!profile) {
        await this.prisma.influencerProfile.update({ where: { id: profileId }, data: { syncStatus: 'IDLE' } });
        return;
      }

      const fakeAccount = [{ platform, followers: profile.followers, engagementRate: profile.engagementRate, avgViews: profile.avgViews }];
      const { qualityScore, performanceScore } = this.computeScores(fakeAccount, profile.growthRate ?? 0);
      const country = profile.country ?? aiData?.audienceCountry ?? null;
      const audienceQualityScore = this.computeAudienceQualityScore(
        profile.postEngagements ?? [],
        profile.engagementRate,
        platform,
        profile.avgViews,
        profile.followers,
      );

      // Download avatar now so the CDN URL never expires in our DB
      const avatarUrl = profile.avatarUrl
        ? (await this.downloadAsDataUrl(profile.avatarUrl)) ?? profile.avatarUrl
        : null;

      await this.prisma.$transaction([
        this.prisma.influencerProfile.update({
          where: { id: profileId },
          data: {
            bio: aiData?.bio ?? profile.bio ?? null,
            categories: (aiData?.category ? [aiData.category.toLowerCase()] : []) as any,
            styleTags: (aiData?.tags?.map(t => t.toLowerCase()) ?? []) as any,
            growthRate: profile.growthRate ?? null,
            country,
            qualityScore,
            performanceScore,
            audienceQualityScore,
            syncStatus: 'IDLE',
            lastSyncedAt: new Date(),
          },
        }),
        this.prisma.platformAccount.updateMany({
          where: { influencerId: profileId, platform },
          data: {
            displayName: profile.displayName ?? null,
            avatarUrl,
            profileUrl: profile.profileUrl ?? null,
            followers: profile.followers,
            engagementRate: profile.engagementRate,
            avgViews: profile.avgViews,
            spotlightVideoId: profile.spotlightVideo?.id ?? null,
            spotlightVideoTitle: profile.spotlightVideo?.title ?? null,
            spotlightThumbnailUrl: profile.spotlightVideo?.thumbnail ?? null,
          },
        }),
      ]);

      await this.ttl.recordEvent(profileId, 'SEARCH');
    } catch (err: any) {
      this.logger.error(`Background fetch failed for ${platform}/${handle}: ${err.message}`);
      await this.prisma.influencerProfile.update({ where: { id: profileId }, data: { syncStatus: 'IDLE' } }).catch(() => {});
    }
  }

  private async saveAndReturnExternalProfile(
    profile: PlatformProfile,
    platform: string,
    handle: string,
    aiData: AiChannelAnalysis | null,
  ) {
    const fakeAccount = [{
      platform,
      followers: profile.followers,
      engagementRate: profile.engagementRate,
      avgViews: profile.avgViews,
    }];
    const { qualityScore, performanceScore } = this.computeScores(fakeAccount, profile.growthRate ?? 0);
    const audienceQualityScore = this.computeAudienceQualityScore(
      profile.postEngagements ?? [],
      profile.engagementRate,
      platform,
      profile.avgViews,
      profile.followers,
    );

    const country = profile.country ?? aiData?.audienceCountry ?? null;

    const saved = await this.prisma.influencerProfile.create({
      data: {
        isExternal: true,
        externalHandle: handle,
        bio: aiData?.bio ?? profile.bio ?? null,
        categories: aiData?.category ? [aiData.category.toLowerCase()] : [],
        styleTags: aiData?.tags?.map(t => t.toLowerCase()) ?? [],
        growthRate: profile.growthRate ?? null,
        country,
        qualityScore,
        performanceScore,
        audienceQualityScore,
        syncStatus: 'IDLE',
        lastSyncedAt: new Date(),
        nextRefreshAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        platformAccounts: {
          create: {
            platform,
            handle,
            displayName: profile.displayName ?? null,
            avatarUrl: profile.avatarUrl ?? null,
            profileUrl: profile.profileUrl ?? null,
            followers: profile.followers,
            engagementRate: profile.engagementRate,
            avgViews: profile.avgViews,
            spotlightVideoId: profile.spotlightVideo?.id ?? null,
            spotlightVideoTitle: profile.spotlightVideo?.title ?? null,
            spotlightThumbnailUrl: profile.spotlightVideo?.thumbnail ?? null,
          },
        },
      },
      include: {
        platformAccounts: true,
        user: { select: { name: true, email: true } },
      },
    });

    await this.ttl.recordEvent(saved.id, 'SEARCH');

    const formatted = this.formatInfluencer(saved);
    return {
      found: true,
      source: 'api' as const,
      influencer: {
        ...formatted,
        meta: {
          ...formatted.meta,
          audienceGender: aiData?.audienceGender ?? null,
          audienceAgeGroup: aiData?.audienceAgeGroup ?? null,
        },
      },
    };
  }

  private formatFromPlatformProfile(
    profile: PlatformProfile,
    platform: string,
    aiData?: AiChannelAnalysis | null,
  ) {
    const fakeAccount = [{
      platform,
      followers: profile.followers,
      engagementRate: profile.engagementRate,
      avgViews: profile.avgViews,
    }];
    const { qualityScore, performanceScore } = this.computeScores(fakeAccount, profile.growthRate ?? 0);

    return {
      id: `live-${platform.toLowerCase()}-${profile.handle}`,
      name: profile.displayName,
      platforms: [platform.toLowerCase()],
      followers: profile.followers,
      followersByPlatform: { [platform.toLowerCase()]: profile.followers },
      avgViewsByPlatform: { [platform.toLowerCase()]: profile.avgViews },
      engagementRate: profile.engagementRate,
      category: aiData?.category ?? 'Lifestyle',
      performanceScore,
      ratePerPost: null,
      stylePresent: aiData?.tags ?? [],
      avatarUrl: profile.avatarUrl ?? null,
      spotlightVideo: profile.spotlightVideo ?? null,
      meta: {
        country: profile.country ?? aiData?.audienceCountry ?? null,
        city: null,
        extraPlatforms: [],
        audienceCountryPercent: null,
        averageViews: profile.avgViews,
        growthRate: profile.growthRate,
        keywords: [],
        intents: [],
        audienceGender: aiData?.audienceGender ?? null,
        audienceAgeGroup: aiData?.audienceAgeGroup ?? null,
        qualityScore,
        responseRate: null,
        bio: aiData?.bio ?? profile.bio,
        profileUrl: profile.profileUrl,
      },
    };
  }

  private async downloadAsDataUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const buffer = await res.arrayBuffer();
      // Skip if image is unreasonably large (>300KB)
      if (buffer.byteLength > 300_000) return null;
      const base64 = Buffer.from(buffer).toString('base64');
      return `data:${contentType};base64,${base64}`;
    } catch {
      return null;
    }
  }
}