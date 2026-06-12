import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  async getCampaignsForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { brandProfile: true, agencyProfile: true },
    });

    if (!user) throw new ForbiddenException();

    if (user.role === 'BRAND' && user.brandProfile) {
      const clientBrand = await this.prisma.clientBrand.findFirst({
        where: { brandProfileId: user.brandProfile.id },
      });
      if (!clientBrand) return [];
      return this.prisma.campaign.findMany({
        where: { clientBrandId: clientBrand.id },
        include: { clientBrand: true, applications: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (user.role === 'AGENCY' && user.agencyProfile) {
      return this.prisma.campaign.findMany({
        where: { clientBrand: { agencyId: user.agencyProfile.id } },
        include: { clientBrand: true, applications: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }

    return [];
  }

  async getPublicCampaigns() {
    return this.prisma.campaign.findMany({
      where: {
        visibility: 'PUBLIC',
        status: { in: ['ACTIVE', 'PUBLIC'] },
      },
      include: { clientBrand: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }
}
