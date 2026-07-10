import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ChatGateway } from './chat.gateway';
import { ConversationAccessService } from './conversation-access.service';
import { v4 as uuidv4 } from 'uuid';

// Maps the client-supplied attachment `type` → both the Conversation field it
// writes and the private-bucket prefix its object lives under.
const ATTACHMENT_KIND: Record<string, { field: string; prefix: string }> = {
  contract: { field: 'contractUrl', prefix: 'contracts' },
  brief: { field: 'briefFileUrl', prefix: 'briefs' },
  payment: { field: 'paymentProofUrl', prefix: 'payment-proofs' },
};

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private chatGateway: ChatGateway,
    private access: ConversationAccessService,
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

  // TODO(separate ticket): resolveClientBrandId picks the agency's FIRST clientBrand
  // via findFirst, ignoring the campaign's own clientBrandId. For a multi-brand
  // agency this can attach the conversation to the wrong brand. Fix by deriving
  // clientBrandId from the campaign and verifying the agency owns it. Out of scope
  // for the messaging-authorization pass.
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

  async findMessages(userId: string, conversationId: string) {
    await this.access.resolveParticipant(userId, conversationId);
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
      include: { sender: { select: { id: true, name: true } } },
    });
  }

  async sendMessage(userId: string, conversationId: string, content: string) {
    await this.access.resolveParticipant(userId, conversationId);
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

  // NOTE: the former `updatePhase` / `PATCH /conversations/:id/phase` endpoint
  // was removed — it let any caller jump a conversation to any phase with no
  // participant check and bypassing the two-sided ready-gate. Phase progression
  // is driven exclusively by markPhaseReady. Re-add here only with the same
  // ownership + ready-gate guarantees if a direct-set use case ever appears.

  async markAsRead(conversationId: string, userId: string) {
    await this.access.resolveParticipant(userId, conversationId);
    await this.prisma.message.updateMany({
      where: { conversationId, isRead: false, senderId: { not: userId } },
      data: { isRead: true },
    });
  }

  async findOne(userId: string, conversationId: string) {
    await this.access.resolveParticipant(userId, conversationId);
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    // Private attachments are stored as paths — sign them for the client.
    const [contractUrl, briefFileUrl, paymentProofUrl] = await Promise.all([
      this.storage.signPrivate(conv.contractUrl),
      this.storage.signPrivate(conv.briefFileUrl),
      this.storage.signPrivate(conv.paymentProofUrl),
    ]);
    return {
      id: conv.id,
      workPhase: conv.workPhase ?? 'contact',
      brandPhaseReady: conv.brandPhaseReady,
      influencerPhaseReady: conv.influencerPhaseReady,
      contractUrl,
      briefFileUrl,
      paymentProofUrl,
    };
  }

  /**
   * Brief phase data for a conversation: the linked Campaign, its CampaignRequirement,
   * and the most recent SmartPlanBrief (if any). Replaces the hardcoded brief seed on the
   * frontend. Returns null fields rather than throwing when a requirement/brief is absent.
   */
  async getBrief(userId: string, conversationId: string) {
    await this.access.resolveParticipant(userId, conversationId);
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
            briefImageUrl: campaign.briefImageUrl,
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
      // Private attachment path → signed URL. (campaign.briefImageUrl above is a
      // public asset and is already an absolute URL.)
      briefFileUrl: await this.storage.signPrivate(conv.briefFileUrl),
    };
  }

  async markPhaseReady(conversationId: string, userId: string) {
    // Participant ownership check (was inline here; now the shared helper — same
    // logic, still the cross-tenant IDOR guard the spec pins down).
    const { isInfluencerOwner } = await this.access.resolveParticipant(
      userId,
      conversationId,
    );

    const updateData: any = isInfluencerOwner
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

  async saveAttachment(
    userId: string,
    conversationId: string,
    type: string,
    file: Express.Multer.File,
  ) {
    await this.access.resolveParticipant(userId, conversationId);
    const kind = ATTACHMENT_KIND[type];
    if (!kind) throw new BadRequestException('Invalid attachment type');

    // Private file: store the storage path; sign at read time.
    const existing = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { [kind.field]: true },
    });
    const objectPath = `${kind.prefix}/${this.storage.buildFilename(file.originalname)}`;
    await this.storage.uploadPrivate(objectPath, file.buffer, file.mimetype);

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { [kind.field]: objectPath, updatedAt: new Date() },
    });
    await this.storage.deletePrivate(
      (existing as Record<string, string | null> | null)?.[kind.field],
    );
    // Return the signed URL (read shape) so the client can render immediately.
    return {
      url: await this.storage.signPrivate(objectPath),
      type,
      conversationId: updated.id,
    };
  }
}
