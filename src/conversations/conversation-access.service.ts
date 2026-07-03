import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ConversationParticipant = {
  role: string;
  isInfluencerOwner: boolean;
  isBrandSide: boolean;
  // The conversation (with clientBrand) is returned so callers that already need
  // it — e.g. markPhaseReady's phase-advance — don't re-query.
  conversation: {
    id: string;
    influencerId: string;
    workPhase: string | null;
    brandPhaseReady: boolean;
    influencerPhaseReady: boolean;
  };
};

/**
 * Single source of truth for "is this user a participant in this conversation?".
 *
 * Depends only on PrismaService so it can be shared by both ConversationsService
 * and ChatGateway without the circular dependency those two already have
 * (ConversationsService ↔ ChatGateway). Mirrors the participant check that
 * previously lived inline in ConversationsService.markPhaseReady and is
 * duplicated in DraftsService/PaymentsService.resolveParticipant.
 *
 * TODO(consolidate): DraftsService and PaymentsService still carry their own
 * copies of this logic — fold them onto this service in a follow-up.
 */
@Injectable()
export class ConversationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveParticipant(
    userId: string,
    conversationId: string,
  ): Promise<ConversationParticipant> {
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

    // Brand/agency may act only on a conversation under their OWN clientBrand.
    // AGENCY ownership via clientBrand.agencyId already covers agency-managed
    // brands (their agencyId is the managing agency) — no special case needed.
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
      role: user.role as string,
      isInfluencerOwner,
      isBrandSide,
      conversation: {
        id: conv.id,
        influencerId: conv.influencerId,
        workPhase: conv.workPhase,
        brandPhaseReady: conv.brandPhaseReady,
        influencerPhaseReady: conv.influencerPhaseReady,
      },
    };
  }
}
