/**
 * TEST PLAN — DraftsService (conversation-scoped draft CRUD + review)
 * ==================================================================
 * Plain unit tests (no NestJS TestingModule) with a hand-rolled mock Prisma,
 * matching the style of campaigns.service.spec.ts.
 *
 * Permissions
 * -----------
 * TC-01: INFLUENCER owner can create a draft
 * TC-02: BRAND cannot create a draft (Forbidden)
 * TC-03: INFLUENCER owner can edit / delete their draft
 * TC-04: BRAND cannot edit a draft (Forbidden)
 * TC-05: BRAND can review (approve) a draft
 * TC-06: INFLUENCER cannot review a draft (Forbidden)
 * TC-07: Requesting revision without a note throws BadRequest
 * TC-08: A non-participant is rejected (Forbidden)
 * TC-09: Both roles can list drafts
 */

import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { DraftsService } from './drafts.service';

const INF_USER = {
  id: 'u-inf',
  role: 'INFLUENCER',
  influencerProfile: { id: 'inf-1' },
  brandProfile: null,
  agencyProfile: null,
};
const BRAND_USER = {
  id: 'u-brand',
  role: 'BRAND',
  influencerProfile: null,
  brandProfile: { id: 'bp-1' },
  agencyProfile: null,
};
const STRANGER = {
  id: 'u-x',
  role: 'INFLUENCER',
  influencerProfile: { id: 'inf-other' },
  brandProfile: null,
  agencyProfile: null,
};
const CONV = {
  id: 'conv-1',
  campaignId: 'camp-1',
  clientBrandId: 'cb-1',
  influencerId: 'inf-1',
  clientBrand: { id: 'cb-1', brandProfileId: 'bp-1', agencyId: null },
};
const DRAFT = {
  id: 'draft-1',
  conversationId: 'conv-1',
  title: 'Hook v1',
  status: 'DRAFT',
};

function build(user: any, conv: any = CONV) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    conversation: { findUnique: jest.fn().mockResolvedValue(conv) },
    draft: {
      findMany: jest.fn().mockResolvedValue([DRAFT]),
      findUnique: jest.fn().mockResolvedValue(DRAFT),
      create: jest.fn().mockResolvedValue(DRAFT),
      update: jest.fn().mockImplementation(({ data }) => ({ ...DRAFT, ...data })),
      delete: jest.fn().mockResolvedValue(DRAFT),
    },
  };
  const gateway: any = { emitDraftsUpdate: jest.fn() };
  const service = new DraftsService(prisma, gateway);
  return { service, prisma, gateway };
}

describe('DraftsService permissions', () => {
  it('TC-01: influencer owner can create a draft', async () => {
    const { service, prisma, gateway } = build(INF_USER);
    const res = await service.create('u-inf', 'conv-1', { title: 'Hook v1' });
    expect(prisma.draft.create).toHaveBeenCalledTimes(1);
    expect(gateway.emitDraftsUpdate).toHaveBeenCalledWith('conv-1');
    expect(res).toEqual(DRAFT);
  });

  it('TC-02: brand cannot create a draft', async () => {
    const { service, prisma } = build(BRAND_USER);
    await expect(
      service.create('u-brand', 'conv-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.draft.create).not.toHaveBeenCalled();
  });

  it('TC-03: influencer owner can edit and delete their draft', async () => {
    const { service, prisma } = build(INF_USER);
    await service.update('u-inf', 'conv-1', 'draft-1', { title: 'Hook v2' });
    expect(prisma.draft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'draft-1' } }),
    );
    await service.remove('u-inf', 'conv-1', 'draft-1');
    expect(prisma.draft.delete).toHaveBeenCalledWith({ where: { id: 'draft-1' } });
  });

  it('TC-04: brand cannot edit a draft', async () => {
    const { service } = build(BRAND_USER);
    await expect(
      service.update('u-brand', 'conv-1', 'draft-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('TC-05: brand can review (approve) a draft', async () => {
    const { service, prisma, gateway } = build(BRAND_USER);
    const res = await service.review('u-brand', 'conv-1', 'draft-1', {
      status: 'APPROVED',
    });
    expect(res.status).toBe('APPROVED');
    expect(prisma.draft.update).toHaveBeenCalled();
    expect(gateway.emitDraftsUpdate).toHaveBeenCalledWith('conv-1');
  });

  it('TC-06: influencer cannot review a draft', async () => {
    const { service } = build(INF_USER);
    await expect(
      service.review('u-inf', 'conv-1', 'draft-1', { status: 'APPROVED' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('TC-07: requesting revision without a note throws BadRequest', async () => {
    const { service } = build(BRAND_USER);
    await expect(
      service.review('u-brand', 'conv-1', 'draft-1', {
        status: 'REVISION_REQUESTED',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC-08: a non-participant is rejected', async () => {
    const { service } = build(STRANGER);
    await expect(
      service.create('u-x', 'conv-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('TC-09: both roles can list drafts', async () => {
    const inf = build(INF_USER);
    const brand = build(BRAND_USER);
    expect(await inf.service.list('u-inf', 'conv-1')).toEqual([DRAFT]);
    expect(await brand.service.list('u-brand', 'conv-1')).toEqual([DRAFT]);
  });
});
