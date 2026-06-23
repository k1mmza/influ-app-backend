/**
 * TEST PLAN — ConversationsService.getBrief (brief data-join endpoint)
 * ===================================================================
 * TC-01: joins campaign + requirement + latest SmartPlanBrief for a conversation
 * TC-02: returns null requirement/smartPlanBrief when absent (no throw)
 * TC-03: throws NotFound when the conversation does not exist
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

function build(conv: any) {
  const prisma: any = {
    conversation: { findUnique: jest.fn().mockResolvedValue(conv) },
  };
  const gateway: any = {};
  const service = new ConversationsService(prisma, gateway);
  return { service, prisma };
}

function buildPhaseReady(user: any, conv: any) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    conversation: {
      findUnique: jest.fn().mockResolvedValue(conv),
      // echo the patch back onto the conversation so flag/phase reads work
      update: jest
        .fn()
        .mockImplementation(({ data }: any) => ({ ...conv, ...data })),
    },
  };
  const gateway: any = { emitPhaseUpdate: jest.fn() };
  const service = new ConversationsService(prisma, gateway);
  return { service, prisma, gateway };
}

describe('ConversationsService.getBrief', () => {
  it('TC-01: joins campaign + requirement + latest smart plan brief', async () => {
    const conv = {
      id: 'conv-1',
      briefFileUrl: '/uploads/conversations/brief.pdf',
      campaign: {
        id: 'camp-1',
        name: 'Summer Skincare',
        objective: 'Awareness',
        budget: 120000,
        paymentType: 'Full',
        keyMessage: 'Gentle routine',
        deliverables: '2 TikToks',
        doAndDont: 'No medical claims',
        applyDeadline: null,
        submissionDate: null,
        requirements: [
          {
            minFollowers: 10000,
            minEngagementRate: 3,
            minAvgViews: null,
            platforms: ['tiktok'],
            locations: null,
            categories: ['beauty'],
            followerTier: null,
            contentType: 'video',
          },
        ],
        smartPlanBriefs: [
          {
            id: 'spb-1',
            strategy: 'S',
            concept: 'C',
            briefBody: 'B',
            generatedBrief: 'Full generated brief',
            inputMode: 'AI',
          },
        ],
      },
    };
    const { service } = build(conv);
    const res = await service.getBrief('conv-1');

    expect(res.campaign?.name).toBe('Summer Skincare');
    expect(res.campaign?.keyMessage).toBe('Gentle routine');
    expect(res.requirement?.minFollowers).toBe(10000);
    expect(res.requirement?.platforms).toEqual(['tiktok']);
    expect(res.smartPlanBrief?.generatedBrief).toBe('Full generated brief');
    expect(res.briefFileUrl).toBe('/uploads/conversations/brief.pdf');
  });

  it('TC-02: returns null requirement/smartPlanBrief when absent', async () => {
    const conv = {
      id: 'conv-2',
      briefFileUrl: null,
      campaign: {
        id: 'camp-2',
        name: 'Bare Campaign',
        objective: null,
        budget: null,
        paymentType: null,
        keyMessage: null,
        deliverables: null,
        doAndDont: null,
        applyDeadline: null,
        submissionDate: null,
        requirements: [],
        smartPlanBriefs: [],
      },
    };
    const { service } = build(conv);
    const res = await service.getBrief('conv-2');

    expect(res.campaign?.name).toBe('Bare Campaign');
    expect(res.requirement).toBeNull();
    expect(res.smartPlanBrief).toBeNull();
    expect(res.briefFileUrl).toBeNull();
  });

  it('TC-03: throws NotFound when the conversation does not exist', async () => {
    const { service } = build(null);
    await expect(service.getBrief('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * TEST PLAN — ConversationsService.markPhaseReady (ownership scoping)
 * ===================================================================
 * Regression guard for the cross-tenant IDOR: brand/agency access must be
 * scoped to the conversation's own clientBrand, not granted by role alone.
 * TC-04: owning BRAND is allowed -> sets brandPhaseReady, broadcasts
 * TC-05: non-owning BRAND is rejected (403), no write
 * TC-06: non-owning AGENCY is rejected (403), no write
 */
describe('ConversationsService.markPhaseReady ownership', () => {
  const conv = {
    id: 'conv-1',
    influencerId: 'inf-1',
    workPhase: 'contact',
    brandPhaseReady: false,
    influencerPhaseReady: false,
    clientBrand: { brandProfileId: 'bp-1', agencyId: null },
  };

  it('TC-04: owning brand may mark phase-ready', async () => {
    const owningBrand = {
      id: 'u-brand',
      role: 'BRAND',
      brandProfile: { id: 'bp-1' },
      agencyProfile: null,
      influencerProfile: null,
    };
    const { service, prisma, gateway } = buildPhaseReady(owningBrand, conv);
    const res = await service.markPhaseReady('conv-1', 'u-brand');

    expect(res.brandPhaseReady).toBe(true);
    expect(res.workPhase).toBe('contact'); // one-sided, no advance
    expect(prisma.conversation.update).toHaveBeenCalledTimes(1);
    expect(gateway.emitPhaseUpdate).toHaveBeenCalledTimes(1);
  });

  it('TC-05: non-owning brand is forbidden (cross-tenant IDOR guard)', async () => {
    const otherBrand = {
      id: 'u-other',
      role: 'BRAND',
      brandProfile: { id: 'bp-2' }, // does NOT own conv.clientBrand (bp-1)
      agencyProfile: null,
      influencerProfile: null,
    };
    const { service, prisma, gateway } = buildPhaseReady(otherBrand, conv);
    await expect(
      service.markPhaseReady('conv-1', 'u-other'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(gateway.emitPhaseUpdate).not.toHaveBeenCalled();
  });

  it('TC-06: non-owning agency is forbidden', async () => {
    const otherAgency = {
      id: 'u-ag',
      role: 'AGENCY',
      brandProfile: null,
      agencyProfile: { id: 'ag-2' }, // conv.clientBrand.agencyId is null
      influencerProfile: null,
    };
    const { service, prisma } = buildPhaseReady(otherAgency, conv);
    await expect(
      service.markPhaseReady('conv-1', 'u-ag'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
