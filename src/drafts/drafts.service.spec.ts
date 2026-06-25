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
 *
 * Tracking bridge (approved Draft -> SubmittedContent)
 * ----------------------------------------------------
 * TC-08: Approving a draft with a link bridges into SubmittedContent (in a tx)
 * TC-09: Requesting a revision does not bridge
 * TC-10: Approving with no link/file does not bridge
 * TC-11: A bridge failure rolls the approval back (error propagates from the tx)
 * TC-12: Missing application logs a data-integrity warning and skips the bridge
 */

import {
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
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
  linkUrl: null,
  fileUrl: null,
  contentType: null,
};
// Approved draft carrying a published URL — the bridgeable case.
const DRAFT_WITH_LINK = {
  ...DRAFT,
  linkUrl: 'https://tiktok.com/@x/video/1',
  contentType: 'video',
};

function build(user: any, conv: any = CONV, draft: any = DRAFT) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    conversation: { findUnique: jest.fn().mockResolvedValue(conv) },
    draft: {
      findMany: jest.fn().mockResolvedValue([DRAFT]),
      findUnique: jest.fn().mockResolvedValue(draft),
      create: jest.fn().mockResolvedValue(DRAFT),
      update: jest.fn().mockImplementation(({ data }) => ({ ...draft, ...data })),
      delete: jest.fn().mockResolvedValue(DRAFT),
    },
    campaignApplication: {
      findFirst: jest.fn().mockResolvedValue({ id: 'app-1' }),
    },
    submittedContent: {
      upsert: jest.fn().mockResolvedValue({ id: 'sc-1' }),
    },
  };
  // Interactive transaction: run the callback with the same mock as the tx
  // client, so assertions on prisma.* observe the in-transaction writes.
  prisma.$transaction = jest
    .fn()
    .mockImplementation((cb: any) => cb(prisma));
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

  it('TC-08: approving a draft with a link bridges into SubmittedContent (inside a tx)', async () => {
    const { service, prisma } = build(BRAND_USER, CONV, DRAFT_WITH_LINK);
    await service.review('u-brand', 'conv-1', 'draft-1', { status: 'APPROVED' });
    // The status flip + bridge must share one interactive transaction.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.campaignApplication.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'camp-1', influencerId: 'inf-1' },
      }),
    );
    expect(prisma.submittedContent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { draftId: 'draft-1' },
        create: expect.objectContaining({
          applicationId: 'app-1',
          draftId: 'draft-1',
          contentUrl: 'https://tiktok.com/@x/video/1',
          contentType: 'video',
          reviewStatus: 'APPROVED',
        }),
      }),
    );
  });

  it('TC-09: requesting a revision does not bridge', async () => {
    const { service, prisma } = build(BRAND_USER, CONV, DRAFT_WITH_LINK);
    await service.review('u-brand', 'conv-1', 'draft-1', {
      status: 'REVISION_REQUESTED',
      revisionNote: 'tighten the hook',
    });
    expect(prisma.submittedContent.upsert).not.toHaveBeenCalled();
  });

  it('TC-10: approving a draft with no link or file does not bridge', async () => {
    const { service, prisma } = build(BRAND_USER); // default DRAFT has no link/file
    await service.review('u-brand', 'conv-1', 'draft-1', { status: 'APPROVED' });
    expect(prisma.submittedContent.upsert).not.toHaveBeenCalled();
  });

  it('TC-11: a bridge failure rolls back the approval (error propagates from the tx)', async () => {
    const { service, prisma } = build(BRAND_USER, CONV, DRAFT_WITH_LINK);
    prisma.submittedContent.upsert.mockRejectedValueOnce(new Error('db down'));
    // Because the upsert runs inside $transaction, its rejection bubbles out of
    // review() — the caller sees an error rather than a silently half-applied
    // approval. (Real Postgres rolls the Draft.update back on this path.)
    await expect(
      service.review('u-brand', 'conv-1', 'draft-1', { status: 'APPROVED' }),
    ).rejects.toThrow('db down');
  });

  it('TC-12: missing application logs a data-integrity warning and skips the bridge', async () => {
    const { service, prisma } = build(BRAND_USER, CONV, DRAFT_WITH_LINK);
    prisma.campaignApplication.findFirst.mockResolvedValueOnce(null);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await service.review('u-brand', 'conv-1', 'draft-1', { status: 'APPROVED' });
    expect(prisma.submittedContent.upsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no CampaignApplication'),
    );
    warn.mockRestore();
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
