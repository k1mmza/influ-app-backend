/**
 * TEST PLAN — ConversationsService.getBrief (brief data-join endpoint)
 * ===================================================================
 * TC-01: joins campaign + requirement + latest SmartPlanBrief for a conversation
 * TC-02: returns null requirement/smartPlanBrief when absent (no throw)
 * TC-03: throws NotFound when the conversation does not exist
 */

import { NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

function build(conv: any) {
  const prisma: any = {
    conversation: { findUnique: jest.fn().mockResolvedValue(conv) },
  };
  const gateway: any = {};
  const service = new ConversationsService(prisma, gateway);
  return { service, prisma };
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
