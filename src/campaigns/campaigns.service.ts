import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { notify } from '../notifications/notify';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private conversations: ConversationsService,
  ) {}

  private async findUserWithProfiles(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: true,
        agencyProfile: true,
        influencerProfile: { include: { platformAccounts: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private assertCampaignOwnership(user: any, campaign: any) {
    if (
      user.role === 'BRAND' &&
      user.brandProfile?.id &&
      campaign.clientBrand?.brandProfileId === user.brandProfile.id
    ) {
      return;
    }
    if (
      user.role === 'AGENCY' &&
      user.agencyProfile?.id &&
      campaign.clientBrand?.agencyId === user.agencyProfile.id
    ) {
      return;
    }
    throw new NotFoundException('Campaign not found');
  }

  private mapRequirements(requirements: any[] | undefined) {
    return requirements?.map((req) => ({
      minFollowers: req.minFollowers,
      minEngagementRate: req.minEngagementRate,
      minAvgViews: req.minAvgViews,
      platforms: req.platforms ?? undefined,
      locations: req.locations ?? undefined,
      categories: req.categories ?? undefined,
      followerTier: req.followerTier ?? undefined,
      contentType: req.contentType ?? undefined,
    }));
  }

  private parseDate(value?: string) {
    return value ? new Date(value) : undefined;
  }

  private async getOrCreateClientBrandForBrand(user: any) {
    if (!user.brandProfile?.id) {
      throw new ForbiddenException(
        'Brand profile is required to create campaigns',
      );
    }

    const existing = await this.prisma.clientBrand.findFirst({
      where: { brandProfileId: user.brandProfile.id },
    });
    if (existing) return existing;

    const data: Prisma.ClientBrandUncheckedCreateInput = {
      agencyId: null,
      brandProfileId: user.brandProfile.id,
      brandName: user.brandProfile.companyName ?? user.name ?? user.email,
      brandContact: user.brandProfile.telephone,
      brandEmail: user.email,
      brandWebsite: user.brandProfile.websiteUrl,
      isRegistered: true,
    };
    console.log('Creating ClientBrand for brand:', user.brandProfile.id);
    const clientBrand = await this.prisma.clientBrand.create({ data });
    console.log('Created ClientBrand:', clientBrand.id);

    return clientBrand;
  }

  async createCampaign(userId: string, dto: CreateCampaignDto) {
    const user = await this.findUserWithProfiles(userId);
    let clientBrandId: string | undefined;

    if (user.role === 'BRAND' && user.brandProfile) {
      const clientBrand = await this.getOrCreateClientBrandForBrand(user);
      clientBrandId = clientBrand.id;
    } else if (user.role === 'AGENCY' && user.agencyProfile) {
      if (!dto.clientBrandId)
        throw new BadRequestException(
          'clientBrandId is required for agency users',
        );
      const clientBrand = await this.prisma.clientBrand.findUnique({
        where: { id: dto.clientBrandId },
      });
      if (!clientBrand || clientBrand.agencyId !== user.agencyProfile.id) {
        throw new ForbiddenException('Invalid client brand');
      }
      clientBrandId = clientBrand.id;
    } else {
      throw new ForbiddenException(
        'Only brand and agency users can create campaigns',
      );
    }

    return this.prisma.campaign.create({
      data: {
        clientBrandId,
        name: dto.name,
        objective: dto.objective,
        budget: dto.budget,
        visibility: dto.visibility,
        status: 'DRAFT',
        paymentType: dto.paymentType,
        keyMessage: dto.keyMessage,
        doAndDont: dto.doAndDont,
        deliverables: dto.deliverables,
        applyDeadline: this.parseDate(dto.applyDeadline),
        submissionDate: this.parseDate(dto.submissionDate),
        reviewDate: this.parseDate(dto.reviewDate),
        paymentDate: this.parseDate(dto.paymentDate),
        requirements: dto.requirements?.length
          ? { create: this.mapRequirements(dto.requirements) }
          : undefined,
      },
      include: {
        requirements: true,
        applications: { select: { id: true } },
        clientBrand: true,
      },
    });
  }

  async getCampaign(userId: string, campaignId: string) {
    const user = await this.findUserWithProfiles(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId, deletedAt: null },
      include: { requirements: true, applications: true, clientBrand: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    this.assertCampaignOwnership(user, campaign);
    return campaign;
  }

  async updateCampaign(
    userId: string,
    campaignId: string,
    dto: UpdateCampaignDto,
  ) {
    const user = await this.findUserWithProfiles(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId, deletedAt: null },
      include: { clientBrand: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    this.assertCampaignOwnership(user, campaign);

    if (dto.status && dto.status !== campaign.status) {
      const validTransitions: Record<string, string[]> = {
        DRAFT: ['DRAFT', 'ACTIVE', 'CANCELLED'],
        ACTIVE: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
        COMPLETED: ['COMPLETED'],
        CANCELLED: ['CANCELLED'],
      };
      const allowed = validTransitions[campaign.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException('Invalid status transition');
      }
    }

    // COMMERCIAL-TERM LOCK
    // Once a campaign has ≥1 ACCEPTED application (from either an APPLICATION or
    // INVITATION origin — both terminate at status 'ACCEPTED'), its commercial
    // terms are frozen so they can't be changed out from under confirmed creators
    // (and to keep downstream budget/deliverable math consistent). This is keyed
    // off the ACCEPTED count, NOT Campaign.status, because an invite can be
    // accepted while the campaign is still DRAFT.
    const acceptedCount = await this.prisma.campaignApplication.count({
      where: { campaignId, status: 'ACCEPTED' },
    });
    if (acceptedCount > 0) {
      const violations: string[] = [];

      // LOCK bucket: reject any scalar term whose incoming value differs from the
      // stored value. Present-but-unchanged is fine (not a change).
      if (dto.budget !== undefined && dto.budget !== campaign.budget) {
        violations.push('budget');
      }
      if (
        dto.paymentType !== undefined &&
        dto.paymentType !== campaign.paymentType
      ) {
        violations.push('paymentType');
      }
      if (
        dto.deliverables !== undefined &&
        dto.deliverables !== campaign.deliverables
      ) {
        violations.push('deliverables');
      }
      if (
        dto.clientBrandId !== undefined &&
        dto.clientBrandId !== campaign.clientBrandId
      ) {
        violations.push('clientBrandId');
      }

      // requirements[] is a destructive delete-and-recreate — treat any attempt
      // to send it as a single violation rather than diffing the array.
      if (dto.requirements !== undefined) {
        violations.push('requirements');
      }

      // EXTEND-ONLY bucket: dates may move later, never earlier. Setting a date
      // where none existed is allowed (extending from nothing).
      const extendOnly: Array<[keyof UpdateCampaignDto, Date | null]> = [
        ['applyDeadline', campaign.applyDeadline],
        ['submissionDate', campaign.submissionDate],
        ['reviewDate', campaign.reviewDate],
        ['paymentDate', campaign.paymentDate],
      ];
      for (const [field, current] of extendOnly) {
        const raw = dto[field] as string | undefined;
        if (raw === undefined) continue;
        const next = new Date(raw);
        if (current && next.getTime() < current.getTime()) {
          violations.push(field);
        }
      }

      // Reject the whole PATCH atomically — never apply the always-free fields
      // from a request that also tried to touch a locked field.
      if (violations.length) {
        throw new BadRequestException(
          `Cannot change ${violations.join(', ')}: campaign has accepted creators`,
        );
      }
    }

    const updateData: any = {
      name: dto.name,
      objective: dto.objective,
      budget: dto.budget,
      coverImageUrl: dto.coverImageUrl,
      visibility: dto.visibility,
      status: dto.status,
      paymentType: dto.paymentType,
      keyMessage: dto.keyMessage,
      doAndDont: dto.doAndDont,
      deliverables: dto.deliverables,
      applyDeadline: this.parseDate(dto.applyDeadline),
      submissionDate: this.parseDate(dto.submissionDate),
      reviewDate: this.parseDate(dto.reviewDate),
      paymentDate: this.parseDate(dto.paymentDate),
    };

    if (dto.requirements) {
      await this.prisma.$transaction([
        this.prisma.campaignRequirement.deleteMany({ where: { campaignId } }),
        this.prisma.campaign.update({
          where: { id: campaignId },
          data: {
            ...updateData,
            requirements: { create: this.mapRequirements(dto.requirements) },
          },
          include: {
            requirements: true,
            applications: true,
            clientBrand: true,
          },
        }),
      ]);
      return this.prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { requirements: true, applications: true, clientBrand: true },
      });
    }

    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: updateData,
      include: { requirements: true, applications: true, clientBrand: true },
    });
  }

  async uploadCoverImage(
    userId: string,
    campaignId: string,
    coverImageUrl: string,
  ) {
    const user = await this.findUserWithProfiles(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId, deletedAt: null },
      include: { clientBrand: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    this.assertCampaignOwnership(user, campaign);

    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { coverImageUrl },
      include: { requirements: true, applications: true, clientBrand: true },
    });
  }

  async deleteCampaign(userId: string, campaignId: string) {
    const user = await this.findUserWithProfiles(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId, deletedAt: null },
      include: { clientBrand: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    this.assertCampaignOwnership(user, campaign);

    if (!['DRAFT', 'CANCELLED'].includes(campaign.status)) {
      throw new BadRequestException(
        'Only draft or cancelled campaigns can be deleted',
      );
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { deletedAt: new Date() },
    });
  }

  async applyToCampaign(userId: string, campaignId: string) {
    const user = await this.findUserWithProfiles(userId);
    if (user.role !== 'INFLUENCER' || !user.influencerProfile) {
      throw new ForbiddenException('Only influencers can apply to campaigns');
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId, deletedAt: null },
      include: { requirements: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    if (campaign.visibility === 'PRIVATE') {
      throw new ForbiddenException('Campaign is private');
    }

    const accounts = user.influencerProfile.platformAccounts ?? [];

    for (const requirement of campaign.requirements ?? []) {
      const requirementPlatforms = Array.isArray(requirement.platforms)
        ? requirement.platforms.map((p: any) => String(p).toLowerCase())
        : [];
      const candidateAccounts = requirementPlatforms.length
        ? accounts.filter((account) =>
            requirementPlatforms.includes(account.platform.toLowerCase()),
          )
        : accounts;

      if (!candidateAccounts.length) {
        throw new BadRequestException(
          'You do not meet the campaign requirements',
        );
      }

      const meetsRequirement = candidateAccounts.some((account) => {
        if (
          requirement.minFollowers != null &&
          (account.followers ?? 0) < requirement.minFollowers
        ) {
          return false;
        }
        if (
          requirement.minEngagementRate != null &&
          (account.engagementRate ?? 0) < requirement.minEngagementRate
        ) {
          return false;
        }
        if (
          requirement.minAvgViews != null &&
          (account.avgViews ?? 0) < requirement.minAvgViews
        ) {
          return false;
        }
        return true;
      });

      if (!meetsRequirement) {
        throw new BadRequestException(
          'You do not meet the campaign requirements',
        );
      }
    }

    const existingApplication = await this.prisma.campaignApplication.findFirst(
      {
        where: {
          campaignId,
          influencerId: user.influencerProfile.id,
        },
      },
    );
    if (existingApplication) {
      throw new BadRequestException(
        'You have already applied to this campaign',
      );
    }

    return this.prisma.campaignApplication.create({
      data: {
        campaignId,
        influencerId: user.influencerProfile.id,
        status: 'PENDING',
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
  }

  async getApplications(userId: string, campaignId: string) {
    const user = await this.findUserWithProfiles(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId, deletedAt: null },
      include: { clientBrand: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    this.assertCampaignOwnership(user, campaign);

    // TASK 2: fetch all conversations for this campaign in a single query to avoid N+1
    const conversations = await this.prisma.conversation.findMany({
      where: { campaignId },
      select: { id: true, influencerId: true },
    });
    // Build influencerId → conversationId map
    const convByInfluencer = new Map<string, string>(
      conversations.map((c) => [c.influencerId, c.id]),
    );

    const applications = await this.prisma.campaignApplication.findMany({
      where: { campaignId },
      include: {
        influencer: {
          include: {
            user: { select: { name: true, email: true } },
            platformAccounts: true,
          },
        },
      },
    });

    // Attach conversationId (or null) from the in-memory map
    return applications.map((app) => ({
      ...app,
      conversationId: convByInfluencer.get(app.influencerId) ?? null,
    }));
  }

  async updateApplicationStatus(
    userId: string,
    campaignId: string,
    applicationId: string,
    status: string,
  ) {
    const user = await this.findUserWithProfiles(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId, deletedAt: null },
      include: { clientBrand: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    // TASK 3: assertCampaignOwnership already covers brand and agency ownership checks.
    // It throws NotFoundException (masked as 403) if the caller doesn't own the campaign.
    this.assertCampaignOwnership(user, campaign);

    const allowedStatuses = ['PENDING', 'ACCEPTED', 'REJECTED'];
    if (!allowedStatuses.includes(status)) {
      throw new BadRequestException('Invalid application status');
    }

    const application = await this.prisma.campaignApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application || application.campaignId !== campaignId) {
      throw new NotFoundException('Application not found');
    }

    // TASK 1: when accepting, auto-create a conversation (idempotent — safe for double-clicks)
    if (status === 'ACCEPTED') {
      const clientBrandId = campaign.clientBrand?.id;
      if (!clientBrandId)
        throw new BadRequestException(
          'Campaign has no associated client brand',
        );

      const [updatedApplication, conversation] = await this.prisma.$transaction(
        async (tx) => {
          // Shared idempotent find-or-create (race-safe inside this transaction).
          const conv = await this.conversations.ensureConversation(
            application.influencerId,
            clientBrandId,
            campaignId,
            tx,
          );

          // TASK 4: if status changes away from ACCEPTED later, the conversation is intentionally kept.
          // See updateApplicationStatus callers — conversation is never deleted here.
          // TODO: conversation is intentionally kept even if application is later rejected — preserves message history

          const updated = await tx.campaignApplication.update({
            where: { id: applicationId },
            data: { status },
          });

          return [updated, conv];
        },
      );

      // Post-commit, best-effort: tell the influencer their application was accepted.
      const influencer = await this.prisma.influencerProfile.findUnique({
        where: { id: application.influencerId },
        select: { userId: true },
      });
      await notify(this.prisma, {
        userId: influencer?.userId,
        type: 'APPLICATION_ACCEPTED',
        title: 'Application accepted',
        body: `Your application to "${campaign.name}" was accepted.`,
        referenceId: campaignId,
      });

      return { ...updatedApplication, conversationId: conversation.id };
    }

    // TASK 4: status change away from ACCEPTED (e.g. REJECTED) — do NOT delete conversation
    // TODO: conversation is intentionally kept even if application is later rejected — preserves message history
    const updatedApplication = await this.prisma.campaignApplication.update({
      where: { id: applicationId },
      data: { status },
    });

    return { ...updatedApplication, conversationId: null };
  }

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
        where: { clientBrandId: clientBrand.id, deletedAt: null },
        include: {
          clientBrand: true,
          // status + origin let the dashboard surface pending applications
          // awaiting brand review without a per-campaign fan-out.
          applications: {
            select: { id: true, status: true, origin: true, influencerId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (user.role === 'AGENCY' && user.agencyProfile) {
      return this.prisma.campaign.findMany({
        where: {
          clientBrand: { agencyId: user.agencyProfile.id },
          deletedAt: null,
        },
        include: {
          clientBrand: true,
          applications: {
            select: { id: true, status: true, origin: true, influencerId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return [];
  }

  async getPublicCampaigns(page: number, pageSize: number) {
    const where = {
      visibility: 'PUBLIC',
      status: { in: ['ACTIVE', 'PUBLIC'] },
      deletedAt: null,
    };
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
}
