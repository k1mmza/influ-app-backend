import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../conversations/chat.gateway';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { ReviewDraftDto } from './dto/review-draft.dto';

type Participant = {
  role: string;
  isInfluencerOwner: boolean;
  isBrandSide: boolean;
};

@Injectable()
export class DraftsService {
  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  /**
   * Resolve the requesting user's relationship to a conversation. Throws if the
   * conversation is missing or the user is not a participant. Mirrors the
   * participant checks in ConversationsService.markPhaseReady.
   */
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

    return { role: user.role as string, isInfluencerOwner, isBrandSide };
  }

  async list(userId: string, conversationId: string) {
    await this.resolveParticipant(userId, conversationId);
    return this.prisma.draft.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(userId: string, conversationId: string, dto: CreateDraftDto) {
    const { isInfluencerOwner } = await this.resolveParticipant(
      userId,
      conversationId,
    );
    if (!isInfluencerOwner)
      throw new ForbiddenException(
        'Only the influencer can create drafts in this conversation',
      );

    const draft = await this.prisma.draft.create({
      data: {
        id: uuidv4(),
        conversationId,
        title: dto.title,
        notes: dto.notes ?? null,
        linkUrl: dto.linkUrl ?? null,
        contentType: dto.contentType ?? null,
        status: 'DRAFT',
        updatedAt: new Date(),
      },
    });
    this.chatGateway.emitDraftsUpdate(conversationId);
    return draft;
  }

  private async getOwnedDraft(conversationId: string, draftId: string) {
    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
    });
    if (!draft || draft.conversationId !== conversationId)
      throw new NotFoundException('Draft not found');
    return draft;
  }

  async update(
    userId: string,
    conversationId: string,
    draftId: string,
    dto: UpdateDraftDto,
  ) {
    const { isInfluencerOwner } = await this.resolveParticipant(
      userId,
      conversationId,
    );
    if (!isInfluencerOwner)
      throw new ForbiddenException(
        'Only the influencer can edit drafts in this conversation',
      );
    await this.getOwnedDraft(conversationId, draftId);

    const draft = await this.prisma.draft.update({
      where: { id: draftId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.linkUrl !== undefined ? { linkUrl: dto.linkUrl } : {}),
        ...(dto.contentType !== undefined
          ? { contentType: dto.contentType }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    this.chatGateway.emitDraftsUpdate(conversationId);
    return draft;
  }

  async remove(userId: string, conversationId: string, draftId: string) {
    const { isInfluencerOwner } = await this.resolveParticipant(
      userId,
      conversationId,
    );
    if (!isInfluencerOwner)
      throw new ForbiddenException(
        'Only the influencer can delete drafts in this conversation',
      );
    await this.getOwnedDraft(conversationId, draftId);
    await this.prisma.draft.delete({ where: { id: draftId } });
    this.chatGateway.emitDraftsUpdate(conversationId);
    return { id: draftId, deleted: true };
  }

  async review(
    userId: string,
    conversationId: string,
    draftId: string,
    dto: ReviewDraftDto,
  ) {
    const { isBrandSide } = await this.resolveParticipant(
      userId,
      conversationId,
    );
    if (!isBrandSide)
      throw new ForbiddenException(
        'Only the brand or agency can review drafts',
      );
    await this.getOwnedDraft(conversationId, draftId);

    if (dto.status === 'REVISION_REQUESTED' && !dto.revisionNote?.trim())
      throw new BadRequestException(
        'A revision note is required when requesting changes',
      );

    const draft = await this.prisma.draft.update({
      where: { id: draftId },
      data: {
        status: dto.status,
        revisionNote:
          dto.status === 'REVISION_REQUESTED'
            ? (dto.revisionNote ?? null)
            : null,
      },
    });
    this.chatGateway.emitDraftsUpdate(conversationId);
    return draft;
  }

  async saveUpload(
    userId: string,
    conversationId: string,
    draftId: string,
    fileUrl: string,
    contentType: string,
  ) {
    const { isInfluencerOwner } = await this.resolveParticipant(
      userId,
      conversationId,
    );
    if (!isInfluencerOwner)
      throw new ForbiddenException(
        'Only the influencer can upload draft files',
      );
    await this.getOwnedDraft(conversationId, draftId);

    const draft = await this.prisma.draft.update({
      where: { id: draftId },
      data: { fileUrl, contentType },
    });
    this.chatGateway.emitDraftsUpdate(conversationId);
    return draft;
  }
}
