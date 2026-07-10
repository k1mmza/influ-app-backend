import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ChatGateway } from '../conversations/chat.gateway';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { ReviewDraftDto } from './dto/review-draft.dto';
import { parseVideoUrl } from '../sync/video-url';
import { resolveTikTokShortLink } from '../sync/resolve-short-url';
import { notify } from '../notifications/notify';

type Participant = {
  role: string;
  isInfluencerOwner: boolean;
  isBrandSide: boolean;
};

@Injectable()
export class DraftsService {
  private readonly logger = new Logger(DraftsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
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
    const drafts = await this.prisma.draft.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    // fileUrl is a private storage path — sign it. linkUrl (external) is untouched.
    return Promise.all(
      drafts.map(async (d) => ({
        ...d,
        fileUrl: await this.storage.signPrivate(d.fileUrl),
      })),
    );
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

    // Influencer submitting for review → notify the brand/agency side.
    if (dto.status === 'SUBMITTED') {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { clientBrand: { include: { brandProfile: true, agency: true } } },
      });
      await notify(this.prisma, {
        userId:
          conv?.clientBrand?.brandProfile?.userId ?? conv?.clientBrand?.agency?.userId,
        type: 'DRAFT_SUBMITTED',
        title: 'New draft submitted',
        body: `A creator submitted "${draft.title}" for review.`,
        referenceId: conversationId,
      });
    }
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
    const draft = await this.getOwnedDraft(conversationId, draftId);
    await this.prisma.draft.delete({ where: { id: draftId } });
    // Hard delete — remove the attached file object too (best-effort).
    await this.storage.deletePrivate(draft.fileUrl);
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

    // Status flip + tracking bridge commit atomically. A mid-bridge failure
    // rolls the approval back rather than leaving an APPROVED draft with no
    // SubmittedContent — the crash-safety the two-write sequence couldn't give.
    const draft = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.draft.update({
        where: { id: draftId },
        data: {
          status: dto.status,
          revisionNote:
            dto.status === 'REVISION_REQUESTED'
              ? (dto.revisionNote ?? null)
              : null,
        },
      });

      // Bridge approved work into the tracking lineage. An approved Draft
      // becomes a SubmittedContent so it can carry TrackingResult snapshots.
      // Metrics still originate from seed/sync — this only restores the link.
      if (dto.status === 'APPROVED') {
        await this.bridgeApprovedDraft(tx, conversationId, updated);
      }
      return updated;
    });

    // Best-effort, POST-COMMIT: if the approved content is a TikTok short link,
    // resolve it to its canonical /@user/video/<id> so the daily sync can track
    // it. Deliberately OUTSIDE the transaction — the network call must never
    // hold the tx open or be able to roll the approval back. On any failure the
    // row keeps the short-link URL (still `needsResolution`), so the daily sync
    // skips it and it stays visibly untracked rather than silently dropped.
    if (draft.status === 'APPROVED') {
      await this.resolveShortLink(draftId, draft.linkUrl ?? draft.fileUrl);
    }

    this.chatGateway.emitDraftsUpdate(conversationId);

    // Brand/agency reviewed → notify the influencer of the outcome.
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { influencer: true },
    });
    const approved = draft.status === 'APPROVED';
    await notify(this.prisma, {
      userId: conv?.influencer?.userId,
      type: approved ? 'DRAFT_APPROVED' : 'DRAFT_REVISION_REQUESTED',
      title: approved ? 'Draft approved' : 'Revision requested',
      body: approved
        ? `Your draft "${draft.title}" was approved.`
        : `Changes were requested on "${draft.title}".`,
      referenceId: conversationId,
    });
    return draft;
  }

  /**
   * Resolve a TikTok short link on an already-bridged SubmittedContent and
   * persist the canonical URL. Only fires for the `needsResolution` case (a
   * TikTok short link); every other URL is a no-op early return, so normal
   * approvals incur no network call. Fully isolated: a failure here is logged
   * and swallowed — it can never affect the committed Draft approval.
   */
  private async resolveShortLink(
    draftId: string,
    contentUrl: string | null,
  ): Promise<void> {
    try {
      if (!contentUrl) return;
      const parsed = parseVideoUrl(contentUrl);
      // Only a TikTok short link needs resolving (the videoId-null variant).
      if (!parsed || parsed.platform !== 'tiktok' || parsed.videoId !== null) {
        return;
      }

      const canonical = await resolveTikTokShortLink(contentUrl);
      if (!canonical) return; // failed/timed out — leave short URL untracked

      // updateMany (not update) so a skipped bridge — no SubmittedContent row —
      // is a 0-row no-op, never a throw.
      await this.prisma.submittedContent.updateMany({
        where: { draftId },
        data: { contentUrl: canonical },
      });
    } catch (e: any) {
      this.logger.warn(
        `TikTok short-link resolve failed for draft ${draftId}: ${e.message}`,
      );
    }
  }

  /**
   * Upsert a SubmittedContent row for an approved draft, keyed on draftId so
   * re-approval never duplicates. Runs on the caller's transaction client so it
   * commits atomically with the Draft status flip. Skips when there is nothing
   * publishable (no link/file — a normal case); a missing application is a
   * data-integrity signal and is logged before skipping.
   */
  private async bridgeApprovedDraft(
    tx: Prisma.TransactionClient,
    conversationId: string,
    draft: {
      id: string;
      title: string;
      linkUrl: string | null;
      fileUrl: string | null;
      contentType: string | null;
    },
  ) {
    const contentUrl = draft.linkUrl ?? draft.fileUrl;
    if (!contentUrl) return;

    const conv = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { campaignId: true, influencerId: true },
    });
    if (!conv) return;

    const application = await tx.campaignApplication.findFirst({
      where: { campaignId: conv.campaignId, influencerId: conv.influencerId },
      orderBy: { appliedAt: 'desc' },
      select: { id: true },
    });
    if (!application) {
      // A conversation exists for this campaign/influencer but no application
      // links them — should be impossible (conversations require an accepted
      // application). Surface it rather than silently dropping the bridge.
      this.logger.warn(
        `Approved draft ${draft.id} (conversation ${conversationId}) has no CampaignApplication ` +
          `for campaign=${conv.campaignId} influencer=${conv.influencerId}; SubmittedContent not bridged`,
      );
      return;
    }

    await tx.submittedContent.upsert({
      where: { draftId: draft.id },
      create: {
        applicationId: application.id,
        draftId: draft.id,
        contentUrl,
        // title bridges straight from the Draft — no platform sync needed, so it
        // is available for every approved piece of content immediately.
        title: draft.title,
        contentType: draft.contentType,
        reviewStatus: 'APPROVED',
        reviewedAt: new Date(),
      },
      update: {
        contentUrl,
        title: draft.title,
        contentType: draft.contentType,
        reviewStatus: 'APPROVED',
        reviewedAt: new Date(),
      },
    });
  }

  async saveUpload(
    userId: string,
    conversationId: string,
    draftId: string,
    file: Express.Multer.File,
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
    const existing = await this.getOwnedDraft(conversationId, draftId);

    // Private file: store the storage path, replace-delete the old one.
    const objectPath = `drafts/${this.storage.buildFilename(file.originalname)}`;
    await this.storage.uploadPrivate(objectPath, file.buffer, file.mimetype);

    const draft = await this.prisma.draft.update({
      where: { id: draftId },
      data: { fileUrl: objectPath, contentType },
    });
    await this.storage.deletePrivate(existing.fileUrl);
    this.chatGateway.emitDraftsUpdate(conversationId);
    // Return the signed URL (read shape) so the client can render immediately.
    return { ...draft, fileUrl: await this.storage.signPrivate(objectPath) };
  }
}
