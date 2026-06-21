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

    return {
      role: 'influencer',
      stats: {
        walletBalance: user.wallet?.balance || 0,
        activeCampaigns: activeCampaignsCount,
        pendingApplications: pendingAppsCount,
        unreadMessages: 0, // Placeholder
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

    const activeCampaignsCount = clientBrand
      ? await this.prisma.campaign.count({
          where: {
            clientBrandId: clientBrand.id,
            status: 'ACTIVE',
          },
        })
      : 0;

    return {
      role: 'brand',
      stats: {
        activeCampaigns: activeCampaignsCount,
        influencersHired: 0, // Placeholder
        budgetSpent: 0, // Placeholder
        avgEngagement: 0, // Placeholder
        totalReach: 0, // Placeholder
      },
      activeCampaigns: clientBrand
        ? await this.prisma.campaign.findMany({
            where: { clientBrandId: clientBrand.id, status: 'ACTIVE' },
            take: 5,
          })
        : [],
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
