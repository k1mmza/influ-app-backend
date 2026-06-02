import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: true,
        agencyProfile: true,
        influencerProfile: true,
      },
    });

    if (!user) throw new Error('User not found');

    const where: any = {};
    if (user.role === 'INFLUENCER') {
      where.influencerId = user.influencerProfile?.id;
    } else if (user.role === 'BRAND') {
      // Find client brand first
      const clientBrand = await this.prisma.clientBrand.findFirst({
        where: { brandProfileId: user.brandProfile?.id }
      });
      where.clientBrandId = clientBrand?.id;
    } else if (user.role === 'AGENCY') {
      where.clientBrand = { agencyId: user.agencyProfile?.id };
    }

    const conversations = await this.prisma.conversation.findMany({
      where,
      include: {
        campaign: true,
        clientBrand: true,
        influencer: {
          include: {
            user: true
          }
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
    });

    return conversations.map((conv) => ({
      id: conv.id,
      campaignName: conv.campaign?.name,
      partnerName: user.role === 'INFLUENCER' ? conv.clientBrand?.brandName : conv.influencer?.user?.name,
      lastMessage: conv.messages[0]?.content || '',
      lastMessageAt: conv.messages[0]?.sentAt || conv.createdAt,
      unreadCount: 0, // Placeholder
      workPhase: conv.workPhase || 'brief',
    }));
  }

  async findMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
      include: { sender: true },
    });
  }

  async sendMessage(userId: string, conversationId: string, content: string) {
    return this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        content,
      },
    });
  }
}
