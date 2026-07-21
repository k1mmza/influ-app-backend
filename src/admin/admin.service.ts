import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Platform-wide read views for ADMIN users.
 *
 * Every other campaign/conversation read path is ownership-scoped (see
 * ConversationAccessService.resolveParticipant and
 * CampaignsService.getCampaignsForUser). Those are deliberately NOT modified to
 * understand ADMIN: a role branch inside an ownership check is how role-only
 * shortcuts creep back in, which is the class of bug the markPhaseReady IDOR
 * fix closed. Instead the admin surface lives here, behind its own
 * @Roles(ADMIN) controller, and is read-only.
 *
 * Keep this service free of writes. Anything mutating belongs on the
 * ownership-checked path with its own review.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All campaigns across every brand and agency, newest first.
   *
   * Soft-deleted campaigns stay hidden (`deletedAt: null`) to match every other
   * campaign list — admin visibility is "all owners", not "all rows".
   */
  async getAllCampaigns(page: number, pageSize: number) {
    const where = { deletedAt: null };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.campaign.count({ where }),
      this.prisma.campaign.findMany({
        where,
        include: { clientBrand: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** Platform-wide counts for the admin dashboard tiles. */
  async getDashboard() {
    const [campaigns, activeCampaigns, brands, agencies, influencers] =
      await this.prisma.$transaction([
        this.prisma.campaign.count({ where: { deletedAt: null } }),
        this.prisma.campaign.count({
          where: { deletedAt: null, status: 'ACTIVE' },
        }),
        this.prisma.user.count({ where: { role: 'BRAND', isDeleted: false } }),
        this.prisma.user.count({ where: { role: 'AGENCY', isDeleted: false } }),
        this.prisma.user.count({
          where: { role: 'INFLUENCER', isDeleted: false },
        }),
      ]);

    return {
      role: 'admin',
      campaigns,
      activeCampaigns,
      brands,
      agencies,
      influencers,
      users: brands + agencies + influencers,
    };
  }
}
