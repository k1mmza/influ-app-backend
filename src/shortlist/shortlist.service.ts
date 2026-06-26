import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShortlistService {
  constructor(private prisma: PrismaService) {}

  // ── ER benchmarks — mirrors InfluencersService exactly ──────────────────
  private readonly ER_BENCHMARK: Record<string, number> = {
    tiktok: 6,
    instagram: 3,
    youtube: 3,
    facebook: 1,
    x: 0.5,
    lemon8: 4,
  };
  private benchmarkFor(platform: string): number {
    return this.ER_BENCHMARK[platform.toLowerCase()] ?? 4;
  }

  // ── Ownership resolution ─────────────────────────────────────────────────
  //
  // BRAND path:  User → BrandProfile → ClientBrand (1:1 via brandProfileId)
  //              Find or auto-create the ClientBrand, same as CampaignsService.getOrCreateClientBrandForBrand.
  //
  // AGENCY path: User → AgencyProfile → ClientBrand[] (1:N via agencyId)
  //              Write operations use the FIRST ClientBrand (or create one).
  //              Read (getShortlist) aggregates across ALL of the agency's ClientBrands
  //              so no saves are silently hidden behind a different ClientBrand id.
  //
  // TODO: If the product adds per-campaign shortlisting, the Shortlist schema would need
  //       a campaignId field and this resolution would move to a per-campaign context.

  private async resolveWriteClientBrandId(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: { include: { clientBrand: true } },
        agencyProfile: { include: { clientBrands: { take: 1 } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'BRAND') {
      if (!user.brandProfile)
        throw new ForbiddenException('Brand profile required');
      if (user.brandProfile.clientBrand)
        return user.brandProfile.clientBrand.id;
      const created = await this.prisma.clientBrand.create({
        data: {
          brandProfileId: user.brandProfile.id,
          brandName:
            (user as any).brandProfile.companyName ??
            (user as any).name ??
            (user as any).email,
          brandEmail: (user as any).email,
          brandWebsite: (user as any).brandProfile.websiteUrl ?? null,
          isRegistered: true,
        },
      });
      return created.id;
    }

    if (user.role === 'AGENCY') {
      if (!user.agencyProfile)
        throw new ForbiddenException('Agency profile required');
      if (user.agencyProfile.clientBrands.length > 0) {
        return user.agencyProfile.clientBrands[0].id;
      }
      const created = await this.prisma.clientBrand.create({
        data: {
          agencyId: user.agencyProfile.id,
          brandName:
            (user as any).agencyProfile.companyName ??
            (user as any).name ??
            (user as any).email,
          brandEmail: (user as any).email,
          isRegistered: true,
        },
      });
      return created.id;
    }

    throw new ForbiddenException(
      'Only Brand and Agency users can manage shortlists',
    );
  }

  private async resolveAllClientBrandIds(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: { include: { clientBrand: true } },
        agencyProfile: { include: { clientBrands: { select: { id: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'BRAND') {
      return user.brandProfile?.clientBrand
        ? [user.brandProfile.clientBrand.id]
        : [];
    }
    if (user.role === 'AGENCY') {
      return user.agencyProfile?.clientBrands.map((cb) => cb.id) ?? [];
    }
    return [];
  }

  // ── Public methods ───────────────────────────────────────────────────────

  async add(
    userId: string,
    influencerId: string,
  ): Promise<{ success: boolean }> {
    const clientBrandId = await this.resolveWriteClientBrandId(userId);

    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { id: influencerId },
    });
    if (!influencer) throw new NotFoundException('Influencer not found');

    // Atomic upsert keyed on the @@unique([clientBrandId, influencerId]) constraint —
    // no race condition between check and create.
    await this.prisma.shortlist.upsert({
      where: { clientBrandId_influencerId: { clientBrandId, influencerId } },
      create: { clientBrandId, influencerId },
      update: {},
    });
    return { success: true };
  }

  async remove(
    userId: string,
    influencerId: string,
  ): Promise<{ success: boolean }> {
    const clientBrandId = await this.resolveWriteClientBrandId(userId);
    await this.prisma.shortlist.deleteMany({
      where: { clientBrandId, influencerId },
    });
    return { success: true };
  }

  async getShortlist(userId: string) {
    const clientBrandIds = await this.resolveAllClientBrandIds(userId);
    if (!clientBrandIds.length) return [];

    const entries = await this.prisma.shortlist.findMany({
      where: { clientBrandId: { in: clientBrandIds } },
      orderBy: { addedAt: 'desc' },
      include: {
        influencer: {
          include: {
            user: { select: { name: true, email: true } },
            platformAccounts: { include: { audienceInsights: true } },
          },
        },
      },
    });

    // Deduplicate in case the same influencer appears under multiple agency clientBrands
    const seen = new Set<string>();
    return entries
      .filter((e) => {
        if (seen.has(e.influencerId)) return false;
        seen.add(e.influencerId);
        return true;
      })
      .map((e) => this.formatInfluencer(e.influencer));
  }

  // ── Formatter ────────────────────────────────────────────────────────────
  // Mirrors InfluencersService.formatInfluencer.
  // TODO: Extract to src/influencers/influencer.formatter.ts when there are 3+ consumers.

  private computeQualityScore(
    er: number,
    avgViews: number,
    followers: number,
    platform: string,
  ): number {
    const benchmark = this.benchmarkFor(platform);
    const erScore = Math.min(
      60,
      Math.round((er / Math.max(benchmark, 0.1)) * 60),
    );
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
    const engagementQuality = Math.min(
      100,
      Math.round((er / Math.max(benchmark, 0.1)) * 100),
    );
    const growthQuality = Math.min(100, Math.round((growthRate / 20) * 100));
    const consistencyQuality = Math.min(
      100,
      Math.round((followers > 0 ? avgViews / followers : 0) * 300),
    );
    return Math.min(
      100,
      Math.round(
        engagementQuality * 0.3 +
          qualityScore * 0.3 +
          growthQuality * 0.25 +
          consistencyQuality * 0.15,
      ),
    );
  }

  private computeScores(
    accounts: any[],
    growthRate: number,
  ): { qualityScore: number; performanceScore: number } {
    if (!accounts.length) return { qualityScore: 0, performanceScore: 0 };
    const main = accounts.reduce(
      (a: any, b: any) => (a.followers > b.followers ? a : b),
      accounts[0],
    );
    const er = main.engagementRate ?? 0;
    const avgViews = main.avgViews ?? 0;
    const followers = Math.max(main.followers ?? 0, 1);
    const platform = main.platform ?? '';
    const qualityScore = this.computeQualityScore(
      er,
      avgViews,
      followers,
      platform,
    );
    const performanceScore = this.computePerformanceScore(
      er,
      avgViews,
      followers,
      platform,
      growthRate ?? 0,
      qualityScore,
    );
    return { qualityScore, performanceScore };
  }

  private formatInfluencer(inf: any) {
    if (
      inf.isExternal &&
      inf.syncStatus === 'SYNCING' &&
      !inf.platformAccounts?.length
    ) {
      return {
        id: inf.id,
        handle: inf.externalHandle ?? null,
        name: inf.externalHandle ?? 'Loading...',
        platforms: [],
        followers: 0,
        followersByPlatform: {},
        avgViewsByPlatform: {},
        engagementByPlatform: {},
        handleByPlatform: {},
        profileUrlByPlatform: {},
        avatarByPlatform: {},
        syncedAtByPlatform: {},
        spotlightByPlatform: {},
        engagementRate: 0,
        category: 'Lifestyle',
        performanceScore: 0,
        ratePerPost: 0,
        stylePresent: [],
        avatarUrl: null,
        spotlightVideo: null,
        syncStatus: 'SYNCING',
        lastDataPulledAt: null,
        rateCardFileUrl: null,
      };
    }

    const PLATFORM_ORDER = ['youtube', 'tiktok', 'instagram'];
    const accounts = inf.platformAccounts ?? [];

    const sortedAccounts = [...accounts].sort((a: any, b: any) => {
      const ai = PLATFORM_ORDER.indexOf(a.platform);
      const bi = PLATFORM_ORDER.indexOf(b.platform);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const mainAccount = sortedAccounts.length
      ? sortedAccounts.reduce((prev: any, cur: any) =>
          prev.followers > cur.followers ? prev : cur,
        )
      : null;

    const { qualityScore, performanceScore } = this.computeScores(
      accounts,
      inf.growthRate ?? 0,
    );

    const spotlightVideo = mainAccount?.spotlightVideoId
      ? {
          id: mainAccount.spotlightVideoId,
          title: mainAccount.spotlightVideoTitle || '',
          thumbnail:
            mainAccount.spotlightThumbnailUrl ||
            (mainAccount.platform === 'youtube'
              ? `https://img.youtube.com/vi/${mainAccount.spotlightVideoId}/hqdefault.jpg`
              : ''),
        }
      : null;

    const spotlightByPlatform = sortedAccounts.reduce(
      (acc: any, p: any) => ({
        ...acc,
        [p.platform]: p.spotlightVideoId
          ? {
              id: p.spotlightVideoId,
              title: p.spotlightVideoTitle || '',
              thumbnail:
                p.spotlightThumbnailUrl ||
                (p.platform === 'youtube'
                  ? `https://img.youtube.com/vi/${p.spotlightVideoId}/hqdefault.jpg`
                  : ''),
            }
          : null,
      }),
      {},
    );

    // Per-platform analytics maps — mirror InfluencersService.formatInfluencer so the
    // detail panel renders identically when opened from the Shortlist page.
    const watchTimeMinsByPlatform = sortedAccounts.reduce(
      (acc: any, p: any) => ({ ...acc, [p.platform]: p.watchTimeMins ?? null }),
      {},
    );
    const avgViewDurationByPlatform = sortedAccounts.reduce(
      (acc: any, p: any) => ({
        ...acc,
        [p.platform]: p.avgViewDuration ?? null,
      }),
      {},
    );
    const avgViewPctByPlatform = sortedAccounts.reduce(
      (acc: any, p: any) => ({ ...acc, [p.platform]: p.avgViewPct ?? null }),
      {},
    );
    const subscribersGainedByPlatform = sortedAccounts.reduce(
      (acc: any, p: any) => ({
        ...acc,
        [p.platform]: p.subscribersGained ?? null,
      }),
      {},
    );
    const topCountriesByPlatform = sortedAccounts.reduce(
      (acc: any, p: any) => ({ ...acc, [p.platform]: p.topCountries ?? null }),
      {},
    );
    const audienceInsightsByPlatform = sortedAccounts.reduce(
      (acc: any, p: any) => {
        const insight = p.audienceInsights?.[0] ?? null;
        return {
          ...acc,
          [p.platform]: insight
            ? {
                malePct: insight.malePct ?? null,
                femalePct: insight.femalePct ?? null,
                ageDistribution: insight.ageDistribution ?? null,
              }
            : null,
        };
      },
      {},
    );

    const mainInsight = mainAccount?.audienceInsights?.[0] ?? null;

    return {
      id: inf.id,
      handle: mainAccount?.handle ?? null,
      name: inf.user?.name || mainAccount?.displayName || 'Unknown',
      platforms: sortedAccounts.map((p: any) => p.platform),
      followers: mainAccount?.followers ?? 0,
      followersByPlatform: sortedAccounts.reduce(
        (acc: any, p: any) => ({ ...acc, [p.platform]: p.followers }),
        {},
      ),
      avgViewsByPlatform: sortedAccounts.reduce(
        (acc: any, p: any) => ({ ...acc, [p.platform]: p.avgViews }),
        {},
      ),
      engagementByPlatform: sortedAccounts.reduce(
        (acc: any, p: any) => ({ ...acc, [p.platform]: p.engagementRate }),
        {},
      ),
      handleByPlatform: sortedAccounts.reduce(
        (acc: any, p: any) => ({ ...acc, [p.platform]: p.handle }),
        {},
      ),
      // Per-platform public profile URLs — used as contact points on the profile.
      profileUrlByPlatform: sortedAccounts.reduce(
        (acc: any, p: any) => ({ ...acc, [p.platform]: p.profileUrl ?? null }),
        {},
      ),
      avatarByPlatform: sortedAccounts.reduce(
        (acc: any, p: any) => ({ ...acc, [p.platform]: p.avatarUrl ?? null }),
        {},
      ),
      syncedAtByPlatform: sortedAccounts.reduce(
        (acc: any, p: any) => ({ ...acc, [p.platform]: p.syncedAt ?? null }),
        {},
      ),
      spotlightByPlatform,
      watchTimeMinsByPlatform,
      avgViewDurationByPlatform,
      avgViewPctByPlatform,
      subscribersGainedByPlatform,
      topCountriesByPlatform,
      audienceInsightsByPlatform,
      engagementRate: mainAccount?.engagementRate ?? 0,
      category: Array.isArray(inf.categories)
        ? inf.categories[0]
        : inf.categories || 'lifestyle',
      performanceScore,
      ratePerPost: 0,
      stylePresent: Array.isArray(inf.styleTags) ? inf.styleTags : [],
      avatarUrl: mainAccount?.avatarUrl ?? null,
      spotlightVideo,
      syncStatus: inf.syncStatus ?? 'IDLE',
      lastDataPulledAt: mainAccount?.syncedAt ?? inf.lastSyncedAt ?? null,
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
        watchTimeMins: mainAccount?.watchTimeMins ?? null,
        avgViewDuration: mainAccount?.avgViewDuration ?? null,
        avgViewPct: mainAccount?.avgViewPct ?? null,
        subscribersGained: mainAccount?.subscribersGained ?? null,
        topCountries: mainAccount?.topCountries ?? null,
        audienceInsights: mainInsight
          ? {
              malePct: mainInsight.malePct ?? null,
              femalePct: mainInsight.femalePct ?? null,
              ageDistribution: mainInsight.ageDistribution ?? null,
            }
          : null,
      },
    };
  }
}
