import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  private async resolveClientBrandId(
    _userId: string,
    role: string,
    brandProfile: any,
    agencyProfile: any,
  ): Promise<string | null> {
    if (role === 'BRAND') {
      const cb = await this.prisma.clientBrand.findFirst({
        where: { brandProfileId: brandProfile?.id },
      });
      return cb?.id ?? null;
    }
    if (role === 'AGENCY') {
      const cb = await this.prisma.clientBrand.findFirst({
        where: { agencyId: agencyProfile?.id },
      });
      return cb?.id ?? null;
    }
    return null;
  }

  async findAll(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: true,
        agencyProfile: true,
        influencerProfile: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const where: any = {};
    if (user.role === 'INFLUENCER') {
      where.influencerId = user.influencerProfile?.id;
    } else if (user.role === 'BRAND') {
      const clientBrand = await this.prisma.clientBrand.findFirst({
        where: { brandProfileId: user.brandProfile?.id },
      });
      where.clientBrandId = clientBrand?.id;
    } else if (user.role === 'AGENCY') {
      where.clientBrand = { agencyId: user.agencyProfile?.id };
    }

    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        campaign: true,
        clientBrand: true,
        influencer: { include: { user: true } },
        messages: { orderBy: { sentAt: 'desc' }, take: 1 },
      },
    });

    // Unread = messages this user didn't send that aren't marked read yet.
    // One grouped query for all conversations (not an N+1 per-conversation count).
    const unreadGroups = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        isRead: false,
        senderId: { not: userId },
      },
      _count: { _all: true },
    });
    const unreadByConv = new Map(
      unreadGroups.map((g) => [g.conversationId, g._count._all]),
    );

    return conversations.map((conv) => {
      const unreadCount = unreadByConv.get(conv.id) ?? 0;
      return {
        id: conv.id,
        campaignId: conv.campaignId,
        campaignName: conv.campaign?.name ?? null,
        partnerName:
          user.role === 'INFLUENCER'
            ? conv.clientBrand?.brandName
            : (conv.influencer?.user?.name ?? null),
        partnerAvatar: user.role !== 'INFLUENCER' ? null : null,
        lastMessage: conv.messages[0]?.content ?? '',
        lastMessageAt: conv.messages[0]?.sentAt ?? conv.createdAt,
        unreadCount,
        workPhase: conv.workPhase ?? 'contact',
        brandPhaseReady: conv.brandPhaseReady,
        influencerPhaseReady: conv.influencerPhaseReady,
      };
    });
  }

  /**
   * Single source of truth for conversation creation: idempotent find-or-create for the
   * (influencerId, clientBrandId, campaignId) triplet. Pass a transaction client (`tx`) to run
   * inside an existing transaction; defaults to the base Prisma client otherwise.
   * Consumed by createOrFind (below), CampaignsService.updateApplicationStatus (application-accept)
   * and InvitationsService (invite-accept).
   */
  async ensureConversation(
    influencerId: string,
    clientBrandId: string,
    campaignId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await tx.conversation.findFirst({
      where: { influencerId, clientBrandId, campaignId },
    });
    if (existing) return existing;

    return tx.conversation.create({
      data: {
        id: uuidv4(),
        influencerId,
        clientBrandId,
        campaignId,
        workPhase: 'contact',
        updatedAt: new Date(),
      },
    });
  }

  async createOrFind(userId: string, influencerId: string, campaignId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { brandProfile: true, agencyProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'INFLUENCER')
      throw new BadRequestException(
        'Influencers cannot initiate conversations',
      );

    const clientBrandId = await this.resolveClientBrandId(
      userId,
      user.role as string,
      user.brandProfile,
      user.agencyProfile,
    );
    if (!clientBrandId)
      throw new BadRequestException('No client brand found for this account');

    // A conversation row always references an existing campaign (non-null FK, and deleteCampaign
    // removes conversations first), so checking here is equivalent to the previous create-branch check.
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return this.ensureConversation(influencerId, clientBrandId, campaignId);
  }

  async findMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
      include: { sender: { select: { id: true, name: true } } },
    });
  }

  async sendMessage(userId: string, conversationId: string, content: string) {
    const msg = await this.prisma.message.create({
      data: {
        id: uuidv4(),
        conversationId,
        senderId: userId,
        content,
      },
      include: { sender: { select: { id: true, name: true } } },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    this.chatGateway.emitNewMessage(conversationId, msg);
    return msg;
  }

  async updatePhase(conversationId: string, workPhase: string) {
    const valid = ['contact', 'brief', 'draft', 'work', 'payment'];
    if (!valid.includes(workPhase))
      throw new BadRequestException('Invalid work phase');
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { workPhase, updatedAt: new Date() },
    });
  }

  async markAsRead(conversationId: string, userId: string) {
    await this.prisma.message.updateMany({
      where: { conversationId, isRead: false, senderId: { not: userId } },
      data: { isRead: true },
    });
  }

  async findOne(conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return {
      id: conv.id,
      workPhase: conv.workPhase ?? 'contact',
      brandPhaseReady: conv.brandPhaseReady,
      influencerPhaseReady: conv.influencerPhaseReady,
      contractUrl: conv.contractUrl ?? null,
      briefFileUrl: conv.briefFileUrl ?? null,
      paymentProofUrl: conv.paymentProofUrl ?? null,
    };
  }

  /**
   * Brief phase data for a conversation: the linked Campaign, its CampaignRequirement,
   * and the most recent SmartPlanBrief (if any). Replaces the hardcoded brief seed on the
   * frontend. Returns null fields rather than throwing when a requirement/brief is absent.
   */
  async getBrief(conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        campaign: {
          include: {
            requirements: { take: 1 },
            smartPlanBriefs: { orderBy: { updatedAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    const campaign = conv.campaign;
    const requirement = campaign?.requirements?.[0] ?? null;
    const smartPlanBrief = campaign?.smartPlanBriefs?.[0] ?? null;

    return {
      campaign: campaign
        ? {
            id: campaign.id,
            name: campaign.name,
            objective: campaign.objective,
            budget: campaign.budget,
            paymentType: campaign.paymentType,
            keyMessage: campaign.keyMessage,
            deliverables: campaign.deliverables,
            doAndDont: campaign.doAndDont,
            applyDeadline: campaign.applyDeadline,
            submissionDate: campaign.submissionDate,
          }
        : null,
      requirement: requirement
        ? {
            minFollowers: requirement.minFollowers,
            minEngagementRate: requirement.minEngagementRate,
            minAvgViews: requirement.minAvgViews,
            platforms: requirement.platforms,
            locations: requirement.locations,
            categories: requirement.categories,
            followerTier: requirement.followerTier,
            contentType: requirement.contentType,
          }
        : null,
      smartPlanBrief: smartPlanBrief
        ? {
            id: smartPlanBrief.id,
            strategy: smartPlanBrief.strategy,
            concept: smartPlanBrief.concept,
            briefBody: smartPlanBrief.briefBody,
            generatedBrief: smartPlanBrief.generatedBrief,
            inputMode: smartPlanBrief.inputMode,
          }
        : null,
      briefFileUrl: conv.briefFileUrl ?? null,
    };
  }

  async markPhaseReady(conversationId: string, userId: string) {
    const [user, conv] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          influencerProfile: true,
          brandProfile: true,
          agencyProfile: true,
        },
      }),
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { clientBrand: true },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!conv) throw new NotFoundException('Conversation not found');

    const isInfluencer =
      user.role === 'INFLUENCER' &&
      user.influencerProfile?.id === conv.influencerId;
    // Brand/agency may act only on a conversation under their OWN clientBrand —
    // mirrors the ownership checks in DraftsService/PaymentsService.resolveParticipant.
    // (Previously this granted access by role alone → cross-tenant IDOR.)
    const isBrandSide =
      (user.role === 'BRAND' &&
        !!user.brandProfile &&
        conv.clientBrand?.brandProfileId === user.brandProfile.id) ||
      (user.role === 'AGENCY' &&
        !!user.agencyProfile &&
        conv.clientBrand?.agencyId === user.agencyProfile.id);
    if (!isInfluencer && !isBrandSide)
      throw new ForbiddenException('Not a participant in this conversation');

    const updateData: any = isInfluencer
      ? { influencerPhaseReady: true }
      : { brandPhaseReady: true };
    let updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    // Both sides confirmed — advance to next phase and reset flags
    if (updated.brandPhaseReady && updated.influencerPhaseReady) {
      const phases = ['contact', 'brief', 'draft', 'work', 'payment'];
      const currentIdx = phases.indexOf(updated.workPhase ?? 'contact');
      const nextPhase = phases[Math.min(currentIdx + 1, phases.length - 1)];
      if (nextPhase !== updated.workPhase) {
        updated = await this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            workPhase: nextPhase,
            brandPhaseReady: false,
            influencerPhaseReady: false,
            updatedAt: new Date(),
          },
        });
      }
    }

    this.chatGateway.emitPhaseUpdate(conversationId, {
      workPhase: updated.workPhase,
      brandPhaseReady: updated.brandPhaseReady,
      influencerPhaseReady: updated.influencerPhaseReady,
    });

    return {
      workPhase: updated.workPhase,
      brandPhaseReady: updated.brandPhaseReady,
      influencerPhaseReady: updated.influencerPhaseReady,
    };
  }

  async saveAttachment(conversationId: string, type: string, fileUrl: string) {
    const fieldMap: Record<string, string> = {
      contract: 'contractUrl',
      brief: 'briefFileUrl',
      payment: 'paymentProofUrl',
    };
    const field = fieldMap[type];
    if (!field) throw new BadRequestException('Invalid attachment type');
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { [field]: fileUrl, updatedAt: new Date() },
    });
    return { url: fileUrl, type, conversationId: updated.id };
  }
}
