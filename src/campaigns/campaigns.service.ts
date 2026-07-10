import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { notify } from '../notifications/notify';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AddCampaignShortlistDto } from './dto/add-campaign-shortlist.dto';
import { UpdateCampaignShortlistDto } from './dto/update-campaign-shortlist.dto';

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
        briefImageUrl: dto.briefImageUrl,
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

  // Persist a brief reference image onto an EXISTING campaign (upload+replace).
  // Mirrors uploadCoverImage: owner-checked, single field write, and — like the
  // cover upload — intentionally bypasses the commercial-term edit-lock, since the
  // brief image is a private creator-facing reference, not a locked term.
  async uploadBriefImage(
    userId: string,
    campaignId: string,
    briefImageUrl: string,
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
      data: { briefImageUrl },
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
            select: {
              id: true,
              status: true,
              origin: true,
              influencerId: true,
            },
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
            select: {
              id: true,
              status: true,
              origin: true,
              influencerId: true,
            },
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

  // ── Public "Share Campaign" links ─────────────────────────────────────────
  //
  // A share link is an account-less, public URL keyed by a crypto-random token
  // (never the campaign id). Multiple links per campaign are allowed and each is
  // independently revocable, so a leaked link can be killed without breaking
  // others already handed out. Links carry a finite expiry (SHARE_LINK_TTL_DAYS)
  // and lapse on their own; regenerate to extend. Mirrors the tracking module's
  // TrackingShareLink feature (see tracking.service.ts) exactly.

  /** Days a new share link stays valid before auto-expiring. */
  private static readonly SHARE_LINK_TTL_DAYS = 90;

  private shareLinkDto(link: {
    id: string;
    token: string;
    expiresAt: Date | null;
    lastViewedAt: Date | null;
    createdAt: Date;
  }) {
    // No URL is built here — the frontend composes it from its own origin, so the
    // backend never needs to know the public site URL.
    return {
      id: link.id,
      token: link.token,
      expiresAt: link.expiresAt,
      lastViewedAt: link.lastViewedAt,
      createdAt: link.createdAt,
    };
  }

  /** Create a public share link. Owner-only — reuses getCampaign's ownership
   *  gate (throws NotFound for non-owners, incl. agency-managed). */
  async createShareLink(userId: string, campaignId: string) {
    await this.getCampaign(userId, campaignId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + CampaignsService.SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const link = await this.prisma.campaignShareLink.create({
      data: { token, campaignId, createdById: userId, expiresAt },
    });
    return this.shareLinkDto(link);
  }

  /** Active (non-revoked, non-expired) links for a campaign the user owns. */
  async listShareLinks(userId: string, campaignId: string) {
    await this.getCampaign(userId, campaignId);
    const now = new Date();
    const links = await this.prisma.campaignShareLink.findMany({
      where: {
        campaignId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((l) => this.shareLinkDto(l));
  }

  /** Revoke one link (kills just that URL). Ownership re-checked via the link's
   *  own campaign, so a user can only revoke links on campaigns they own. */
  async revokeShareLink(userId: string, linkId: string) {
    const link = await this.prisma.campaignShareLink.findUnique({
      where: { id: linkId },
    });
    if (!link) throw new NotFoundException('Share link not found');
    await this.getCampaign(userId, link.campaignId);
    await this.prisma.campaignShareLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  /**
   * Public, UNAUTHENTICATED campaign view for a share token. Validates the token
   * is active (revoked/expired/unknown all collapse to the SAME 404 — never
   * reveal whether a campaign exists), then returns the explicit public allowlist
   * DTO. A future field added to the campaign cannot leak here unless someone
   * edits publicCampaignDto by hand.
   */
  async getPublicCampaign(token: string) {
    const link = await this.prisma.campaignShareLink.findUnique({
      where: { token },
    });
    const now = new Date();
    const active =
      link &&
      link.revokedAt === null &&
      (link.expiresAt === null || link.expiresAt > now);
    if (!active) {
      throw new NotFoundException('This campaign link is no longer available');
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: link.campaignId, deletedAt: null },
      include: {
        clientBrand: true,
        requirements: true,
        applications: {
          where: { status: 'ACCEPTED' },
          include: {
            influencer: {
              include: { user: { select: { name: true } }, platformAccounts: true },
            },
          },
        },
      },
    });
    if (!campaign) {
      throw new NotFoundException('This campaign link is no longer available');
    }

    // Best-effort usage signal — must never block or fail the response.
    void this.prisma.campaignShareLink
      .update({ where: { id: link.id }, data: { lastViewedAt: now } })
      .catch(() => undefined);

    return this.publicCampaignDto(campaign);
  }

  /**
   * Explicit public allowlist. Built by NAMING every field that ships, not by
   * deleting keys off the campaign — so the presentation-safe surface is a
   * deliberate whitelist. Excludes: campaign id, budget/budgetSpent, paymentType/
   * paymentDate, visibility, application status/origin, and internal timestamps/FKs.
   * `influencers` is the sub-allowlisted ACCEPTED roster (see publicCampaignInfluencerDto).
   */
  private publicCampaignDto(campaign: any) {
    return {
      // always-safe (mirrors tracking's public report DTO)
      name: campaign.name,
      status: campaign.status,
      brandName: campaign.clientBrand?.brandName ?? null,
      brandLogoUrl: campaign.clientBrand?.logoUrl ?? null,
      coverImageUrl: campaign.coverImageUrl ?? null,
      briefImageUrl: campaign.briefImageUrl ?? null,

      // ── review before fully public — delete any line to pull it from the
      //    public surface ──────────────────────────────────────────────────────
      objective: campaign.objective ?? null,
      keyMessage: campaign.keyMessage ?? null,
      doAndDont: campaign.doAndDont ?? null,
      deliverables: campaign.deliverables ?? null,
      startedAt: campaign.createdAt ?? null, // createdAt shown as start date
      submissionDate: campaign.submissionDate ?? null,
      applyDeadline: campaign.applyDeadline ?? null,
      reviewDate: campaign.reviewDate ?? null,
      requirements: this.mapRequirements(campaign.requirements) ?? [],
      influencers: (campaign.applications ?? []).map((app: any) =>
        this.publicCampaignInfluencerDto(app.influencer),
      ),
    };
  }

  /**
   * Explicit public allowlist for a confirmed campaign roster entry. Reuses
   * formatShortlistInfluencer's computation (main platform account, totals, etc.)
   * but re-lists the output fields by name rather than spreading it, so a future
   * field added there for the shortlist feature can't silently leak into this
   * public roster. Excludes: bio, gender, contact info, rate card/pricing,
   * performance/quality/audience scores, application status/origin.
   */
  private publicCampaignInfluencerDto(inf: any) {
    const shared = this.formatShortlistInfluencer(inf);
    return {
      influencerId: shared.id,
      name: shared.name,
      avatarUrl: shared.avatarUrl,
      platforms: shared.platforms,
      mainPlatform: shared.mainPlatform,
      mainFollowers: shared.mainFollowers,
      totalFollowers: shared.totalFollowers,
      handle: shared.handle,
      profileUrl: shared.profileUrl,
      category: shared.category,
      engagementRate: shared.engagementRate,
      country: inf.country ?? null,
    };
  }

  // ── Campaign-scoped shortlist (client-review candidate list) ───────────────
  //
  // Distinct from the brand-global Shortlist and from CampaignApplication
  // invitations. One row per (campaign, influencer) carrying an optional
  // recommendation note + proposed price. All writes/reads are owner-gated by
  // reusing getCampaign's ownership check (NotFound for non-owners).

  /** Compact influencer shape for the shortlist preview — mirrors the columns
   *  the internal + public influencer preview render. Picks the account with the
   *  most followers as the "main" platform. */
  private formatShortlistInfluencer(inf: any) {
    const accounts = inf?.platformAccounts ?? [];
    const main = accounts.length
      ? accounts.reduce((prev: any, cur: any) =>
          (prev.followers ?? 0) > (cur.followers ?? 0) ? prev : cur,
        )
      : null;
    const totalFollowers = accounts.reduce(
      (sum: number, a: any) => sum + (a.followers ?? 0),
      0,
    );
    return {
      id: inf.id,
      name:
        inf.user?.name ||
        main?.displayName ||
        inf.externalHandle ||
        'Unnamed creator',
      avatarUrl: main?.avatarUrl ?? null,
      platforms: accounts.map((a: any) => a.platform),
      mainPlatform: main?.platform ?? null,
      mainFollowers: main?.followers ?? 0,
      totalFollowers,
      handle: main?.handle ?? inf.externalHandle ?? null,
      profileUrl: main?.profileUrl ?? null,
      category: Array.isArray(inf.categories)
        ? inf.categories[0]
        : inf.categories || null,
      engagementRate: main?.engagementRate ?? 0,
    };
  }

  private campaignShortlistDto(row: any) {
    return {
      id: row.id,
      influencerId: row.influencerId,
      recommendationNote: row.recommendationNote ?? null,
      proposedPrice: row.proposedPrice ?? null,
      addedAt: row.addedAt,
      updatedAt: row.updatedAt,
      influencer: this.formatShortlistInfluencer(row.influencer),
    };
  }

  /** Add an influencer to this campaign's shortlist (idempotent upsert). */
  async addToCampaignShortlist(
    userId: string,
    campaignId: string,
    dto: AddCampaignShortlistDto,
  ) {
    await this.getCampaign(userId, campaignId);
    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { id: dto.influencerId },
    });
    if (!influencer) throw new NotFoundException('Influencer not found');

    const row = await this.prisma.campaignShortlist.upsert({
      where: {
        campaignId_influencerId: { campaignId, influencerId: dto.influencerId },
      },
      create: {
        campaignId,
        influencerId: dto.influencerId,
        recommendationNote: dto.recommendationNote ?? null,
        proposedPrice: dto.proposedPrice ?? null,
        createdById: userId,
      },
      // Re-adding an existing entry leaves its note/price untouched.
      update: {},
      include: {
        influencer: {
          include: { user: { select: { name: true } }, platformAccounts: true },
        },
      },
    });
    return this.campaignShortlistDto(row);
  }

  /** Remove an influencer from this campaign's shortlist. */
  async removeFromCampaignShortlist(
    userId: string,
    campaignId: string,
    influencerId: string,
  ) {
    await this.getCampaign(userId, campaignId);
    await this.prisma.campaignShortlist.deleteMany({
      where: { campaignId, influencerId },
    });
    return { success: true };
  }

  /** Update the note and/or proposed price for one shortlisted influencer. */
  async updateCampaignShortlistNote(
    userId: string,
    campaignId: string,
    influencerId: string,
    dto: UpdateCampaignShortlistDto,
  ) {
    await this.getCampaign(userId, campaignId);
    const existing = await this.prisma.campaignShortlist.findUnique({
      where: { campaignId_influencerId: { campaignId, influencerId } },
    });
    if (!existing) {
      throw new NotFoundException(
        'Influencer is not on this campaign shortlist',
      );
    }
    // Only overwrite fields explicitly provided; null clears, undefined leaves as-is.
    const data: Prisma.CampaignShortlistUpdateInput = {};
    if (dto.recommendationNote !== undefined)
      data.recommendationNote = dto.recommendationNote;
    if (dto.proposedPrice !== undefined) data.proposedPrice = dto.proposedPrice;

    const row = await this.prisma.campaignShortlist.update({
      where: { campaignId_influencerId: { campaignId, influencerId } },
      data,
      include: {
        influencer: {
          include: { user: { select: { name: true } }, platformAccounts: true },
        },
      },
    });
    return this.campaignShortlistDto(row);
  }

  /** Owner-only: the campaign's shortlist with notes/prices, newest first. */
  async getCampaignShortlist(userId: string, campaignId: string) {
    await this.getCampaign(userId, campaignId);
    const rows = await this.prisma.campaignShortlist.findMany({
      where: { campaignId },
      orderBy: { addedAt: 'desc' },
      include: {
        influencer: {
          include: { user: { select: { name: true } }, platformAccounts: true },
        },
      },
    });
    return rows.map((r) => this.campaignShortlistDto(r));
  }

  // ── Public influencers-preview share links ─────────────────────────────────
  //
  // A SEPARATE link type from CampaignShareLink (the brief share) so the
  // influencer list — which exposes proposedPrice + recommendationNote — is
  // revocable independently. Otherwise an exact clone of the brief-share flow:
  // crypto-random token, finite expiry, individually revocable, uniform 404 for
  // unknown/revoked/expired tokens.

  /** Mint a public influencers-preview link. Owner-only via getCampaign. */
  async createShortlistShareLink(userId: string, campaignId: string) {
    await this.getCampaign(userId, campaignId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + CampaignsService.SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const link = await this.prisma.campaignShortlistShareLink.create({
      data: { token, campaignId, createdById: userId, expiresAt },
    });
    return this.shareLinkDto(link);
  }

  /** Active (non-revoked, non-expired) influencers-preview links the user owns. */
  async listShortlistShareLinks(userId: string, campaignId: string) {
    await this.getCampaign(userId, campaignId);
    const now = new Date();
    const links = await this.prisma.campaignShortlistShareLink.findMany({
      where: {
        campaignId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((l) => this.shareLinkDto(l));
  }

  /** Revoke one influencers-preview link. Ownership re-checked via its campaign. */
  async revokeShortlistShareLink(userId: string, linkId: string) {
    const link = await this.prisma.campaignShortlistShareLink.findUnique({
      where: { id: linkId },
    });
    if (!link) throw new NotFoundException('Share link not found');
    await this.getCampaign(userId, link.campaignId);
    await this.prisma.campaignShortlistShareLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  /**
   * Public, UNAUTHENTICATED influencers preview for a share token. Validates the
   * token is active (unknown/revoked/expired all collapse to the SAME 404), then
   * returns an explicit allowlist: campaign name/objective + the shortlist rows
   * with per-influencer note/price. Campaign budget, payment, and applicant data
   * are deliberately never included.
   */
  async getPublicInfluencerList(token: string) {
    const link = await this.prisma.campaignShortlistShareLink.findUnique({
      where: { token },
    });
    const now = new Date();
    const active =
      link &&
      link.revokedAt === null &&
      (link.expiresAt === null || link.expiresAt > now);
    if (!active) {
      throw new NotFoundException('This link is no longer available');
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: link.campaignId, deletedAt: null },
      include: { clientBrand: true },
    });
    if (!campaign) {
      throw new NotFoundException('This link is no longer available');
    }

    const rows = await this.prisma.campaignShortlist.findMany({
      where: { campaignId: link.campaignId },
      orderBy: { addedAt: 'desc' },
      include: {
        influencer: {
          include: { user: { select: { name: true } }, platformAccounts: true },
        },
      },
    });

    // Best-effort usage signal — must never block or fail the response.
    void this.prisma.campaignShortlistShareLink
      .update({ where: { id: link.id }, data: { lastViewedAt: now } })
      .catch(() => undefined);

    return this.publicInfluencerListDto(campaign, rows);
  }

  /**
   * Explicit public allowlist for the influencers preview. Built by NAMING every
   * field that ships. proposedPrice IS shown (the point of the surface); campaign
   * budget/payment and any influencer contact fields are intentionally excluded.
   */
  private publicInfluencerListDto(campaign: any, rows: any[]) {
    return {
      campaign: {
        name: campaign.name,
        objective: campaign.objective ?? null,
        brandName: campaign.clientBrand?.brandName ?? null,
      },
      influencers: rows.map((row) => {
        const inf = this.formatShortlistInfluencer(row.influencer);
        return {
          influencerId: row.influencerId,
          name: inf.name,
          avatarUrl: inf.avatarUrl,
          platforms: inf.platforms,
          mainPlatform: inf.mainPlatform,
          mainFollowers: inf.mainFollowers,
          totalFollowers: inf.totalFollowers,
          handle: inf.handle,
          profileUrl: inf.profileUrl,
          category: inf.category,
          engagementRate: inf.engagementRate,
          recommendationNote: row.recommendationNote ?? null,
          proposedPrice: row.proposedPrice ?? null,
        };
      }),
    };
  }
}
