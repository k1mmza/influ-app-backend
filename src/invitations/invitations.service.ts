import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';

/** Discriminates the outcome of an invite so the frontend can react (toast vs. error). */
export type InviteResult =
  | 'INVITED' // brand-new invitation created
  | 'RE_INVITED' // previously declined/rejected — flipped back to INVITED
  | 'ALREADY_INVITED' // an open invitation already exists (idempotent)
  | 'ALREADY_ACCEPTED'; // already linked + conversation exists (idempotent)

@Injectable()
export class InvitationsService {
  constructor(
    private prisma: PrismaService,
    private conversations: ConversationsService,
  ) {}

  // ── Ownership resolution ───────────────────────────────────────────────────
  // Mirrors ShortlistService.resolveAllClientBrandIds:
  //   BRAND  → User → BrandProfile → ClientBrand (1:1)
  //   AGENCY → User → AgencyProfile → ClientBrand[] (1:N)
  private async resolveClientBrandIds(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: { include: { clientBrand: true } },
        agencyProfile: { include: { clientBrands: { select: { id: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'BRAND') {
      return user.brandProfile?.clientBrand
        ? [user.brandProfile.clientBrand.id]
        : [];
    }
    if (user.role === 'AGENCY') {
      return user.agencyProfile?.clientBrands.map((cb) => cb.id) ?? [];
    }
    return [];
  }

  private async resolveInfluencerProfileId(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { influencerProfile: { select: { id: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'INFLUENCER' || !user.influencerProfile) {
      throw new ForbiddenException('Only influencers have invitations');
    }
    return user.influencerProfile.id;
  }

  // ── Accept an invitation: flip to ACCEPTED + ensure a conversation ─────────
  // Transactional + idempotent: same end state as a brand-accepted application. The conversation
  // find-or-create is delegated to the shared ConversationsService.ensureConversation helper.
  private async acceptAndEnsureConversation(
    application: { id: string; influencerId: string; campaignId: string },
    clientBrandId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await this.conversations.ensureConversation(
        application.influencerId,
        clientBrandId,
        application.campaignId,
        tx,
      );

      const updated = await tx.campaignApplication.update({
        where: { id: application.id },
        data: { status: 'ACCEPTED' },
      });

      return { application: updated, conversationId: conversation.id };
    });
  }

  // ── Brand/agency → invite an influencer to a campaign ──────────────────────
  async invite(userId: string, campaignId: string, influencerId: string) {
    const clientBrandIds = await this.resolveClientBrandIds(userId);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, clientBrandId: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    // Verify the caller owns the campaign (decision: any owned campaign, not private-only).
    if (!clientBrandIds.includes(campaign.clientBrandId)) {
      throw new NotFoundException('Campaign not found');
    }

    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { id: influencerId },
      select: { id: true, userId: true, isExternal: true },
    });
    if (!influencer) throw new NotFoundException('Influencer not found');

    // External / URL-derived profiles have no real user account behind them, so
    // an invitation would be dead — nobody can ever see or accept it. `userId`
    // stays null even after a claim (claiming merges into the claimer's OWN
    // profile and leaves this row as a tombstone), so the user-presence check is
    // the reliable guard, not `isExternal` alone.
    if (!influencer.userId) {
      throw new BadRequestException(
        'This creator is not a registered InfluApp user yet and cannot be invited.',
      );
    }

    // find-or-create on the @@unique([campaignId, influencerId]) constraint.
    const existing = await this.prisma.campaignApplication.findUnique({
      where: { campaignId_influencerId: { campaignId, influencerId } },
    });

    if (existing) {
      // Decision #4: an existing influencer-initiated application must NOT be silently overwritten.
      if (existing.status === 'PENDING') {
        throw new ConflictException(
          'This influencer has already applied to this campaign.',
        );
      }
      if (existing.status === 'INVITED') {
        return this.withResult(existing, 'ALREADY_INVITED');
      }
      if (existing.status === 'ACCEPTED') {
        return this.withResult(existing, 'ALREADY_ACCEPTED');
      }
      // REJECTED or DECLINED → re-invite by flipping the same row back to INVITED.
      const reinvited = await this.prisma.campaignApplication.update({
        where: { id: existing.id },
        data: { status: 'INVITED', origin: 'INVITATION' },
      });
      return this.withResult(reinvited, 'RE_INVITED');
    }

    const created = await this.prisma.campaignApplication.create({
      data: {
        campaignId,
        influencerId,
        status: 'INVITED',
        origin: 'INVITATION',
      },
    });
    return this.withResult(created, 'INVITED');
  }

  private withResult<T>(application: T, inviteResult: InviteResult) {
    return { ...application, inviteResult };
  }

  // ── Influencer → list incoming invitations ─────────────────────────────────
  async getInvitations(userId: string) {
    const influencerId = await this.resolveInfluencerProfileId(userId);

    const invites = await this.prisma.campaignApplication.findMany({
      where: { influencerId, status: 'INVITED', origin: 'INVITATION' },
      orderBy: { appliedAt: 'desc' },
      include: { campaign: { include: { clientBrand: true } } },
    });

    return invites.map((invite) => ({
      id: invite.id,
      status: invite.status,
      invitedAt: invite.appliedAt,
      campaignId: invite.campaignId,
      campaignName: invite.campaign?.name ?? null,
      objective: invite.campaign?.objective ?? null,
      budget: invite.campaign?.budget ?? null,
      keyMessage: invite.campaign?.keyMessage ?? null,
      deliverables: invite.campaign?.deliverables ?? null,
      applyDeadline: invite.campaign?.applyDeadline ?? null,
      visibility: invite.campaign?.visibility ?? null,
      brandName: invite.campaign?.clientBrand?.brandName ?? null,
    }));
  }

  // ── Influencer → accept an invitation ──────────────────────────────────────
  async accept(userId: string, applicationId: string) {
    const influencerId = await this.resolveInfluencerProfileId(userId);

    const application = await this.prisma.campaignApplication.findUnique({
      where: { id: applicationId },
      include: { campaign: { include: { clientBrand: true } } },
    });
    if (!application) throw new NotFoundException('Invitation not found');
    if (application.influencerId !== influencerId) {
      throw new ForbiddenException('This invitation does not belong to you');
    }
    if (application.status !== 'INVITED') {
      throw new BadRequestException(
        'This invitation can no longer be accepted',
      );
    }

    const clientBrandId = application.campaign?.clientBrand?.id;
    if (!clientBrandId)
      throw new BadRequestException('Campaign has no associated client brand');

    const { application: updated, conversationId } =
      await this.acceptAndEnsureConversation(application, clientBrandId);
    return { ...updated, conversationId };
  }

  // ── Influencer → decline an invitation ─────────────────────────────────────
  async decline(userId: string, applicationId: string) {
    const influencerId = await this.resolveInfluencerProfileId(userId);

    const application = await this.prisma.campaignApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, influencerId: true, status: true },
    });
    if (!application) throw new NotFoundException('Invitation not found');
    if (application.influencerId !== influencerId) {
      throw new ForbiddenException('This invitation does not belong to you');
    }
    if (application.status !== 'INVITED') {
      throw new BadRequestException(
        'This invitation can no longer be declined',
      );
    }

    return this.prisma.campaignApplication.update({
      where: { id: applicationId },
      data: { status: 'DECLINED' },
    });
  }
}
