import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TtlService, INFLUENCER_SYNC_QUEUE } from '../sync/ttl.service';
import { SyncJobData } from '../sync/sync.processor';
import { YouTubeAdapter } from '../sync/adapters/youtube.adapter';
import { PlatformProfile } from '../sync/adapters/platform.adapter';
import { AiAnalysisService, AiChannelAnalysis } from './ai-analysis.service';
import { SmartSearchService } from './smart-search.service';

@Injectable()
export class InfluencersService {
  constructor(
    private prisma: PrismaService,
    private ttl: TtlService,
    @InjectQueue(INFLUENCER_SYNC_QUEUE) private syncQueue: Queue<SyncJobData>,
    private youtube: YouTubeAdapter,
    private aiAnalysis: AiAnalysisService,
    private smartSearch: SmartSearchService,
  ) {}

  async findAll(query: any) {
    console.log('Received query:', query);
    if (query.q) {
      const aiFilters = await this.smartSearch.parseQuery(query.q);
      // Map AI category (singular) → categories param (plural) that findAll reads
      if (aiFilters.category && !query.categories) {
        (aiFilters as any).categories = aiFilters.category;
      }
      // Map AI platforms array → single platform string
      if ((aiFilters as any).platforms?.length && !query.platform) {
        (aiFilters as any).platform = (aiFilters as any).platforms.join(',').toLowerCase();
      }
      // Merge AI filters with explicit query params (explicit take priority)
      query = { ...aiFilters, ...query, q: undefined };
      if (query.category && !query.categories) query.categories = query.category;
      if (!query.platform && query.platforms) {
        query.platform = Array.isArray(query.platforms)
          ? query.platforms.join(',')
          : query.platforms;
      }
      console.log('Final merged query:', JSON.stringify(query));
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
    // Use string_contains instead of array_contains — more reliable for JSON
    // fields in Postgres. Matches "Gaming" inside ["Gaming"] as substring.
    if (categoriesParam) {
      const categoryList = (categoriesParam as string)
        .split(',')
        .map((c: string) => c.trim())
        .filter(Boolean);
        
      if (categoryList.length === 1) {
        // CHANGE THIS from string_contains to array_contains
        where.categories = { array_contains: categoryList[0] };
      } else if (categoryList.length > 1) {
        andConditions.push({
          OR: categoryList.map((cat: string) => ({
            // CHANGE THIS from string_contains to array_contains
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
          { categories: { string_contains: keyword } },
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
      where.styleTags = { string_contains: stylePresent };
    }

    if (availabilityStatus && availabilityStatus !== 'All') {
      where.availabilityStatus = availabilityStatus;
    }

    if (country) {
      where.country = { equals: country, mode: 'insensitive' };
    }

    console.log('Final where clause:', JSON.stringify(where));

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

  // ── Formatters ────────────────────────────────────────────────────────────

  private formatInfluencer(inf: any) {
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
          thumbnail: `https://img.youtube.com/vi/${mainAccount.spotlightVideoId}/hqdefault.jpg`,
        }
      : null;

    return {
      id: inf.id,
      name: inf.user?.name || mainAccount?.displayName || 'Unknown',
      platforms: accounts.map((p) => p.platform),
      followers: mainAccount?.followers ?? 0,
      followersByPlatform: accounts.reduce((acc, p) => ({ ...acc, [p.platform]: p.followers }), {}),
      avgViewsByPlatform: accounts.reduce((acc, p) => ({ ...acc, [p.platform]: p.avgViews }), {}),
      engagementRate: mainAccount?.engagementRate ?? 0,
      category: Array.isArray(inf.categories) ? inf.categories[0] : (inf.categories || 'Lifestyle'),
      performanceScore,
      ratePerPost: 0,
      stylePresent: Array.isArray(inf.styleTags) ? inf.styleTags : [],
      avatarUrl: mainAccount?.avatarUrl ?? null,
      spotlightVideo,
      meta: {
        country: 'Thailand',
        city: 'Bangkok',
        audienceCountryPercent: 70,
        averageViews: mainAccount?.avgViews ?? 0,
        growthRate: inf.growthRate ?? 0,
        qualityScore,
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
  ): Promise<{ found: boolean; source?: 'db' | 'api'; influencer?: any }> {
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
      return { found: true, source: 'db', influencer: this.formatInfluencer(influencer) };
    }

    if (platform.toLowerCase() === 'youtube') {
      const profile = await this.youtube.fetchProfile(cleanHandle);
      if (profile) {
        const aiData = await this.aiAnalysis.analyzeYouTubeChannel(
          profile.displayName,
          profile.bio,
          profile.topVideoIds ?? [],
          profile.videoTitles ?? [],
        );

        const fakeAccount = [{
          platform: platform.toLowerCase(),
          followers: profile.followers,
          engagementRate: profile.engagementRate,
          avgViews: profile.avgViews,
        }];
        const { qualityScore, performanceScore } = this.computeScores(fakeAccount, profile.growthRate ?? 0);

        const saved = await this.prisma.influencerProfile.create({
          data: {
            isExternal: true,
            externalHandle: cleanHandle,
            bio: aiData?.bio ?? profile.bio ?? null,
            categories: aiData?.category ? [aiData.category] : [],
            styleTags: aiData?.tags ?? [],
            growthRate: profile.growthRate ?? null,
            qualityScore,
            performanceScore,
            syncStatus: 'IDLE',
            lastSyncedAt: new Date(),
            nextRefreshAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            platformAccounts: {
              create: {
                platform: platform.toLowerCase(),
                handle: cleanHandle,
                displayName: profile.displayName ?? null,
                avatarUrl: profile.avatarUrl ?? null,
                profileUrl: profile.profileUrl ?? null,
                followers: profile.followers,
                engagementRate: profile.engagementRate,
                avgViews: profile.avgViews,
                spotlightVideoId: profile.spotlightVideo?.id ?? null,
                spotlightVideoTitle: profile.spotlightVideo?.title ?? null,
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
          source: 'api',
          influencer: {
            ...formatted,
            meta: {
              ...formatted.meta,
              country: profile.country ?? aiData?.audienceCountry ?? null,
              audienceGender: aiData?.audienceGender ?? null,
              audienceAgeGroup: aiData?.audienceAgeGroup ?? null,
            },
          },
        };
      }
    }

    return { found: false };
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
}