import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboardData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        brandProfile: true,
        agencyProfile: true,
        influencerProfile: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.role === 'INFLUENCER') {
      return this.getInfluencerDashboard(user);
    } else if (user.role === 'BRAND') {
      return this.getBrandDashboard(user);
    } else if (user.role === 'AGENCY') {
      return this.getAgencyDashboard(user);
    }

    return {
      role: user.role,
      message: 'Dashboard data not implemented for this role',
    };
  }

  private async getInfluencerDashboard(user: any) {
    const influencerId = user.influencerProfile?.id;

    // Count active campaigns (where application status is ACCEPTED/APPROVED - check schema)
    // In schema, CampaignApplication has status "PENDING" by default.
    // Let's assume "ACCEPTED" for active campaigns.
    const activeCampaignsCount = influencerId
      ? await this.prisma.campaignApplication.count({
          where: {
            influencerId: influencerId,
            status: 'ACCEPTED',
          },
        })
      : 0;

    const pendingAppsCount = influencerId
      ? await this.prisma.campaignApplication.count({
          where: {
            influencerId: influencerId,
            status: 'PENDING',
          },
        })
      : 0;

    // Unread = messages in this influencer's conversations that they didn't send
    // and haven't been marked read yet (markAsRead flips isRead on open).
    const unreadMessagesCount = influencerId
      ? await this.prisma.message.count({
          where: {
            isRead: false,
            senderId: { not: user.id },
            conversation: { influencerId: influencerId },
          },
        })
      : 0;

    // Engagement rate isn't stored on the profile — derive it from the creator's
    // connected platform accounts (average of accounts that have an ER recorded).
    const platformAccounts = influencerId
      ? await this.prisma.platformAccount.findMany({
          where: { influencerId, engagementRate: { gt: 0 } },
          select: { engagementRate: true },
        })
      : [];
    const engagementRate = platformAccounts.length
      ? platformAccounts.reduce((sum, a) => sum + a.engagementRate, 0) /
        platformAccounts.length
      : null;

    const recommendedCampaigns = await this.getRecommendedCampaigns(
      influencerId,
      user.influencerProfile?.categories,
    );

    // Recent Activity — same Notification feed the brand dashboard uses. The
    // influencer-facing rows are written by notify() on draft review, invitation,
    // and application-accept events.
    const recentActivity = await this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, body: true, createdAt: true, isRead: true },
    });

    return {
      role: 'influencer',
      stats: {
        walletBalance: user.wallet?.balance || 0,
        activeCampaigns: activeCampaignsCount,
        pendingApplications: pendingAppsCount,
        unreadMessages: unreadMessagesCount,
        // Performance card — real profile metrics (null when not yet computed).
        growthRate: user.influencerProfile?.growthRate ?? null,
        performanceScore: user.influencerProfile?.performanceScore ?? null,
        engagementRate,
        // Earnings card — real wallet figures.
        totalEarned: user.wallet?.totalEarned ?? 0,
        pendingPayout: user.wallet?.pendingPayout ?? 0,
      },
      recommendedCampaigns,
      recentActivity,
    };
  }

  /**
   * Real recommendations for an influencer: PUBLIC campaigns they have NOT already
   * applied to, ranked by how well the campaign's required categories overlap the
   * influencer's own categories, then by soonest deadline. Replaces the old
   * "first 2 PUBLIC campaigns" placeholder.
   */
  private async getRecommendedCampaigns(
    influencerId: string | undefined,
    influencerCategoriesRaw: unknown,
  ) {
    if (!influencerId) return [];

    const applied = await this.prisma.campaignApplication.findMany({
      where: { influencerId },
      select: { campaignId: true },
    });
    const appliedIds = applied.map((a) => a.campaignId);

    // Pool of eligible campaigns (not applied to), soonest-deadline first. We
    // over-fetch a small pool and re-rank by category overlap in JS — Json array
    // overlap isn't cleanly expressible in a Prisma where-filter.
    const pool = await this.prisma.campaign.findMany({
      // Same eligibility as getPublicCampaigns/applyToCampaign: publicly visible,
      // live, not deleted. NOTE: 'PUBLIC' is the *visibility* field — filtering by
      // status:'PUBLIC' (as the old placeholder did) matches nothing.
      where: {
        visibility: 'PUBLIC',
        status: { in: ['ACTIVE', 'PUBLIC'] },
        deletedAt: null,
        id: appliedIds.length ? { notIn: appliedIds } : undefined,
      },
      orderBy: { applyDeadline: { sort: 'asc', nulls: 'last' } },
      take: 12,
      include: {
        clientBrand: { select: { brandName: true } },
        requirements: { select: { categories: true, platforms: true } },
      },
    });

    const influencerCategories = this.toLowerStringArray(influencerCategoriesRaw);

    const ranked = pool
      .map((c) => {
        const reqCategories = this.toLowerStringArray(
          c.requirements?.[0]?.categories,
        );
        const overlap = reqCategories.filter((cat) =>
          influencerCategories.includes(cat),
        ).length;
        const platforms = this.toStringArray(c.requirements?.[0]?.platforms);
        return {
          id: c.id,
          name: c.name,
          budget: c.budget,
          applyDeadline: c.applyDeadline,
          clientBrand: c.clientBrand,
          platform: platforms[0] ?? null,
          _overlap: overlap,
        };
      })
      // Higher category overlap first; deadline order preserved within a tier
      // because the pool was already deadline-sorted (stable sort).
      .sort((a, b) => b._overlap - a._overlap);

    return ranked.slice(0, 4).map(({ _overlap, ...c }) => c);
  }

  private toStringArray(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  }

  private toLowerStringArray(raw: unknown): string[] {
    return this.toStringArray(raw).map((s) => s.toLowerCase());
  }

  private async getBrandDashboard(user: any) {
    // A brand maps to exactly one ClientBrand.
    const clientBrand = await this.prisma.clientBrand.findFirst({
      where: { brandProfileId: user.brandProfile?.id },
      select: { id: true },
    });
    return this.buildBrandDashboard(
      user,
      clientBrand ? [clientBrand.id] : [],
      'brand',
    );
  }

  private async getAgencyDashboard(user: any) {
    // An agency manages many ClientBrands — aggregate across all of them so the
    // agency sees the same brand-style dashboard, portfolio-wide.
    const brands = user.agencyProfile?.id
      ? await this.prisma.clientBrand.findMany({
          where: { agencyId: user.agencyProfile.id },
          select: { id: true },
        })
      : [];
    return this.buildBrandDashboard(
      user,
      brands.map((b) => b.id),
      'agency',
    );
  }

  /**
   * Shared brand-style dashboard payload, scoped to a set of ClientBrand ids.
   * Brand passes its single id; agency passes every managed brand's id. An empty
   * set → an all-zero/empty shell so the UI renders real "nothing yet" states.
   */
  private async buildBrandDashboard(
    user: any,
    clientBrandIds: string[],
    role: 'brand' | 'agency',
  ) {
    if (clientBrandIds.length === 0) {
      return {
        role,
        stats: {
          activeCampaigns: 0,
          influencersHired: 0,
          budgetSpent: 0,
          avgEngagement: null,
          totalReach: 0,
          unreadMessages: 0,
        },
        activeCampaigns: [],
        performance: { impressions: 0, engagements: 0 },
        payments: {
          paidCount: 0,
          pendingCount: 0,
          activeBudget: 0,
          budgetSpent: 0,
          activeBudgetSpent: 0,
        },
        recentActivity: [],
      };
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: { clientBrandId: { in: clientBrandIds } },
      select: { id: true, budget: true, status: true },
    });
    const campaignIds = campaigns.map((c) => c.id);
    const activeStatuses = ['ACTIVE', 'PUBLIC'];
    const activeCampaigns = campaigns.filter((c) =>
      activeStatuses.includes(c.status),
    );
    const activeBudget = activeCampaigns.reduce(
      (sum, c) => sum + (c.budget ?? 0),
      0,
    );
    const activeCampaignIds = activeCampaigns.map((c) => c.id);

    // Distinct creators with an accepted application across these campaigns.
    const acceptedApps = await this.prisma.campaignApplication.findMany({
      where: { campaignId: { in: campaignIds }, status: 'ACCEPTED' },
      select: { influencerId: true },
      distinct: ['influencerId'],
    });
    const hiredInfluencerIds = acceptedApps.map((a) => a.influencerId);

    // Reach = total audience of hired creators across their platform accounts.
    const reachAgg = hiredInfluencerIds.length
      ? await this.prisma.platformAccount.aggregate({
          where: { influencerId: { in: hiredInfluencerIds } },
          _sum: { followers: true },
        })
      : { _sum: { followers: 0 } };

    // Real money paid out vs. still pending, from the Payment ledger.
    // `paidAgg` is all-time PAID spend for the brand(s) — the "Budget Spent" KPI.
    // `activeSpentAgg` is PAID spend scoped to the *active* campaigns only, so it
    // shares activeBudget's scope and the two can be divided into a real % (the
    // dashboard's "Spent vs Remaining" ratio). Don't mix the two: activeBudget /
    // budgetSpent are different campaign sets and their ratio is meaningless.
    const [paidAgg, pendingCount, activeSpentAgg] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { clientBrandId: { in: clientBrandIds }, status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.count({
        where: {
          clientBrandId: { in: clientBrandIds },
          status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] },
        },
      }),
      activeCampaignIds.length
        ? this.prisma.payment.aggregate({
            where: {
              clientBrandId: { in: clientBrandIds },
              status: 'PAID',
              campaignId: { in: activeCampaignIds },
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: 0 } }),
    ]);

    // Live post metrics aggregated from tracking snapshots.
    const trackingAgg = campaignIds.length
      ? await this.prisma.trackingResult.aggregate({
          where: { campaignId: { in: campaignIds } },
          _sum: { views: true, likes: true, comments: true, shares: true },
          _avg: { engagementRate: true },
        })
      : {
          _sum: { views: 0, likes: 0, comments: 0, shares: 0 },
          _avg: { engagementRate: null },
        };
    const impressions = trackingAgg._sum.views ?? 0;
    const engagements =
      (trackingAgg._sum.likes ?? 0) +
      (trackingAgg._sum.comments ?? 0) +
      (trackingAgg._sum.shares ?? 0);

    const recentActivity = await this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, body: true, createdAt: true, isRead: true },
    });

    // Unread inbound messages across these brands' conversations.
    const unreadMessages = await this.prisma.message.count({
      where: {
        isRead: false,
        senderId: { not: user.id },
        conversation: { clientBrandId: { in: clientBrandIds } },
      },
    });

    // The ≤5 active campaigns shown on the dashboard card.
    const activeCampaignRows = await this.prisma.campaign.findMany({
      where: {
        clientBrandId: { in: clientBrandIds },
        status: { in: activeStatuses },
      },
      select: {
        id: true,
        name: true,
        status: true,
        budget: true,
        // Applicant count via _count — single query, no per-campaign fan-out.
        _count: { select: { applications: true } },
      },
      take: 5,
    });

    // Per-campaign spent = confirmed (PAID) payments grouped by campaign — the
    // same ledger the dashboard-level budgetSpent uses. The Campaign.budgetSpent
    // column is never written at runtime (only in seed data), so it can't back
    // this. Scoped to the shown campaigns; a single groupBy, no N+1.
    const spentByCampaign = activeCampaignRows.length
      ? await this.prisma.payment.groupBy({
          by: ['campaignId'],
          where: {
            clientBrandId: { in: clientBrandIds },
            status: 'PAID',
            campaignId: { in: activeCampaignRows.map((c) => c.id) },
          },
          _sum: { amount: true },
        })
      : [];
    const spentByCampaignId = new Map(
      spentByCampaign.map((g) => [g.campaignId, g._sum.amount ?? 0]),
    );
    const activeCampaignsList = activeCampaignRows.map((c) => ({
      ...c,
      budgetSpent: spentByCampaignId.get(c.id) ?? 0,
    }));

    return {
      role,
      stats: {
        activeCampaigns: activeCampaigns.length,
        influencersHired: hiredInfluencerIds.length,
        budgetSpent: paidAgg._sum.amount ?? 0,
        avgEngagement: trackingAgg._avg.engagementRate ?? null,
        totalReach: reachAgg._sum.followers ?? 0,
        unreadMessages,
      },
      activeCampaigns: activeCampaignsList,
      performance: { impressions, engagements },
      payments: {
        paidCount: paidAgg._count,
        pendingCount,
        activeBudget,
        budgetSpent: paidAgg._sum.amount ?? 0,
        // Scoped to active campaigns — pairs with activeBudget for the % ratio.
        activeBudgetSpent: activeSpentAgg._sum.amount ?? 0,
      },
      recentActivity,
    };
  }
}
