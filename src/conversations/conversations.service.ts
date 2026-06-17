import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  private async resolveClientBrandId(_userId: string, role: string, brandProfile: any, agencyProfile: any): Promise<string | null> {
    if (role === 'BRAND') {
      const cb = await this.prisma.clientBrand.findFirst({ where: { brandProfileId: brandProfile?.id } });
      return cb?.id ?? null;
    }
    if (role === 'AGENCY') {
      const cb = await this.prisma.clientBrand.findFirst({ where: { agencyId: agencyProfile?.id } });
      return cb?.id ?? null;
    }
    return null;
  }

  async findAll(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { brandProfile: true, agencyProfile: true, influencerProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const where: any = {};
    if (user.role === 'INFLUENCER') {
      where.influencerId = user.influencerProfile?.id;
    } else if (user.role === 'BRAND') {
      const clientBrand = await this.prisma.clientBrand.findFirst({ where: { brandProfileId: user.brandProfile?.id } });
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

    return conversations.map((conv) => {
      const unreadCount = 0; // computed in markAsRead; placeholder here
      return {
        id: conv.id,
        campaignId: conv.campaignId,
        campaignName: conv.campaign?.name ?? null,
        partnerName: user.role === 'INFLUENCER' ? conv.clientBrand?.brandName : (conv.influencer?.user?.name ?? null),
        partnerAvatar: user.role !== 'INFLUENCER' ? null : null,
        lastMessage: conv.messages[0]?.content ?? '',
        lastMessageAt: conv.messages[0]?.sentAt ?? conv.createdAt,
        unreadCount,
        workPhase: conv.workPhase ?? 'brief',
      };
    });
  }

  async createOrFind(userId: string, influencerId: string, campaignId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { brandProfile: true, agencyProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'INFLUENCER') throw new BadRequestException('Influencers cannot initiate conversations');

    const clientBrandId = await this.resolveClientBrandId(userId, user.role as string, user.brandProfile, user.agencyProfile);
    if (!clientBrandId) throw new BadRequestException('No client brand found for this account');

    const existing = await this.prisma.conversation.findFirst({
      where: { influencerId, clientBrandId, campaignId },
    });
    if (existing) return existing;

    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return this.prisma.conversation.create({
      data: {
        id: uuidv4(),
        influencerId,
        clientBrandId,
        campaignId,
        workPhase: 'brief',
        updatedAt: new Date(),
      },
    });
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
    if (!valid.includes(workPhase)) throw new BadRequestException('Invalid work phase');
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
      workPhase: conv.workPhase ?? 'brief',
      contractUrl: conv.contractUrl ?? null,
      briefFileUrl: conv.briefFileUrl ?? null,
      paymentProofUrl: conv.paymentProofUrl ?? null,
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
