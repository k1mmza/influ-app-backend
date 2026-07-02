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
      recommendedCampaigns: await this.prisma.campaign.findMany({
        take: 2,
        where: { status: 'PUBLIC' },
        include: { clientBrand: true },
      }),
    };
  }

  private async getBrandDashboard(user: any) {
    const brandProfileId = user.brandProfile?.id;

    // For brands, they are linked to ClientBrand in the schema
    const clientBrand = await this.prisma.clientBrand.findFirst({
      where: { brandProfileId: brandProfileId },
    });

    // No brand workspace yet → return an all-zero/empty shell so the UI renders
    // real "nothing yet" states instead of fabricated numbers.
    if (!clientBrand) {
      return {
        role: 'brand',
        stats: {
          activeCampaigns: 0,
          influencersHired: 0,
          budgetSpent: 0,
          avgEngagement: null,
          totalReach: 0,
        },
        activeCampaigns: [],
        performance: { impressions: 0, engagements: 0 },
        payments: { paidCount: 0, pendingCount: 0, activeBudget: 0, budgetSpent: 0 },
        recentActivity: [],
      };
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: { clientBrandId: clientBrand.id },
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

    // Distinct creators with an accepted application across this brand's campaigns.
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
    const [paidAgg, pendingCount] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { clientBrandId: clientBrand.id, status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.count({
        where: {
          clientBrandId: clientBrand.id,
          status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] },
        },
      }),
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

    // The ≤5 active campaigns shown on the dashboard card.
    const activeCampaignRows = await this.prisma.campaign.findMany({
      where: { clientBrandId: clientBrand.id, status: { in: activeStatuses } },
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
            clientBrandId: clientBrand.id,
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
      role: 'brand',
      stats: {
        activeCampaigns: activeCampaigns.length,
        influencersHired: hiredInfluencerIds.length,
        budgetSpent: paidAgg._sum.amount ?? 0,
        avgEngagement: trackingAgg._avg.engagementRate ?? null,
        totalReach: reachAgg._sum.followers ?? 0,
      },
      activeCampaigns: activeCampaignsList,
      performance: { impressions, engagements },
      payments: {
        paidCount: paidAgg._count,
        pendingCount,
        activeBudget,
        budgetSpent: paidAgg._sum.amount ?? 0,
      },
      recentActivity,
    };
  }

  private async getAgencyDashboard(user: any) {
    const agencyProfileId = user.agencyProfile?.id;

    const activeBriefsCount = agencyProfileId
      ? await this.prisma.campaign.count({
          where: {
            clientBrand: { agencyId: agencyProfileId },
            status: 'ACTIVE',
          },
        })
      : 0;

    return {
      role: 'agency',
      stats: {
        activeBriefs: activeBriefsCount,
        creatorsAssigned: 0, // Placeholder
        spendMTD: 0, // Placeholder
        slaOnTrack: '100%', // Placeholder
      },
    };
  }
}
