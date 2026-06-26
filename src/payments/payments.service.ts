import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../conversations/chat.gateway';
import { CreatePaymentDto } from './dto/create-payment.dto';

type Participant = {
  userId: string;
  isInfluencerOwner: boolean;
  isBrandSide: boolean;
  conv: {
    id: string;
    campaignId: string;
    clientBrandId: string;
    influencerId: string;
  };
};

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  private async resolveParticipant(
    userId: string,
    conversationId: string,
  ): Promise<Participant> {
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

    const isInfluencerOwner =
      user.role === 'INFLUENCER' &&
      !!user.influencerProfile &&
      user.influencerProfile.id === conv.influencerId;

    const isBrandSide =
      (user.role === 'BRAND' &&
        !!user.brandProfile &&
        conv.clientBrand?.brandProfileId === user.brandProfile.id) ||
      (user.role === 'AGENCY' &&
        !!user.agencyProfile &&
        conv.clientBrand?.agencyId === user.agencyProfile.id);

    if (!isInfluencerOwner && !isBrandSide)
      throw new ForbiddenException('Not a participant in this conversation');

    return {
      userId,
      isInfluencerOwner,
      isBrandSide,
      conv: {
        id: conv.id,
        campaignId: conv.campaignId,
        clientBrandId: conv.clientBrandId,
        influencerId: conv.influencerId,
      },
    };
  }

  async list(userId: string, conversationId: string) {
    const { conv } = await this.resolveParticipant(userId, conversationId);
    return this.prisma.payment.findMany({
      where: { campaignId: conv.campaignId, influencerId: conv.influencerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(userId: string, conversationId: string, dto: CreatePaymentDto) {
    const { isBrandSide, conv } = await this.resolveParticipant(
      userId,
      conversationId,
    );
    if (!isBrandSide)
      throw new ForbiddenException(
        'Only the brand or agency can create a payment',
      );

    const payment = await this.prisma.payment.create({
      data: {
        id: uuidv4(),
        campaignId: conv.campaignId,
        clientBrandId: conv.clientBrandId,
        influencerId: conv.influencerId,
        amount: dto.amount,
        paymentType: dto.paymentType ?? null,
        status: 'PENDING',
      },
    });
    this.chatGateway.emitPaymentsUpdate(conversationId);
    return payment;
  }

  private async getScopedPayment(conv: Participant['conv'], paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (
      !payment ||
      payment.campaignId !== conv.campaignId ||
      payment.influencerId !== conv.influencerId
    )
      throw new NotFoundException('Payment not found');
    return payment;
  }

  async uploadProof(
    userId: string,
    conversationId: string,
    paymentId: string,
    fileUrl: string,
  ) {
    const { isBrandSide, conv } = await this.resolveParticipant(
      userId,
      conversationId,
    );
    if (!isBrandSide)
      throw new ForbiddenException(
        'Only the brand or agency can upload payment proof',
      );
    const payment = await this.getScopedPayment(conv, paymentId);
    if (payment.status === 'PAID')
      throw new BadRequestException('Payment is already confirmed as paid');

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { proofUrl: fileUrl, status: 'AWAITING_CONFIRMATION' },
    });
    this.chatGateway.emitPaymentsUpdate(conversationId);
    return updated;
  }

  /**
   * Influencer confirms they received the off-platform transfer. This is the ONLY
   * path to PAID — the brand cannot mark a payment paid unilaterally. Sets confirmedAt
   * and credits the influencer's wallet, all in one transaction.
   */
  async confirm(userId: string, conversationId: string, paymentId: string) {
    const { isInfluencerOwner, conv } = await this.resolveParticipant(
      userId,
      conversationId,
    );
    if (!isInfluencerOwner)
      throw new ForbiddenException(
        'Only the influencer can confirm receipt of payment',
      );
    const payment = await this.getScopedPayment(conv, paymentId);

    if (payment.status === 'PAID')
      throw new BadRequestException('Payment is already confirmed');
    if (payment.status !== 'AWAITING_CONFIRMATION')
      throw new BadRequestException(
        'Payment must have an uploaded proof before it can be confirmed',
      );

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'PAID', confirmedAt: now, paidAt: now },
      }),
      this.prisma.wallet.upsert({
        where: { userId },
        create: {
          id: uuidv4(),
          userId,
          totalEarned: payment.amount,
          lastPaymentAmount: payment.amount,
          lastPaymentAt: now,
          updatedAt: now,
        },
        update: {
          totalEarned: { increment: payment.amount },
          lastPaymentAmount: payment.amount,
          lastPaymentAt: now,
        },
      }),
    ]);
    this.chatGateway.emitPaymentsUpdate(conversationId);
    return updated;
  }
}
