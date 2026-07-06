/**
 * TEST PLAN — TrackingService share links + public report
 * =======================================================
 * TC-SL-01: createShareLink enforces ownership (getCampaign) and mints a token
 *           with a finite future expiry
 * TC-SL-02: getPublicReport returns the presentation-safe allowlist — no
 *           campaign.id, PUBLISHED-ONLY content, and no status/submittedAt on rows
 * TC-SL-03: getPublicReport collapses unknown / revoked / expired tokens to the
 *           same NotFound (never reveals whether a campaign exists)
 * TC-SL-04: revokeShareLink re-checks ownership then sets revokedAt; unknown id → NotFound
 */

import { NotFoundException } from '@nestjs/common';
import { TrackingService } from './tracking.service';

const CAMPAIGN = {
  id: 'camp-1',
  name: 'Glow',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01'),
  submissionDate: null,
  clientBrand: { brandName: 'Acme', logoUrl: null },
  applications: [{ status: 'ACCEPTED' }, { status: 'ACCEPTED' }],
};

// One APPROVED (published) content + one PENDING; only the APPROVED one should
// surface in the public report.
const CONTENTS = [
  {
    id: 'sc-approved',
    reviewStatus: 'APPROVED',
    contentUrl: 'https://youtu.be/abc',
    contentType: 'video',
    title: 'Hello',
    thumbnailUrl: null,
    publishedAt: new Date('2026-01-05'),
    reviewedAt: new Date('2026-01-04'),
    submittedAt: new Date('2026-01-02'),
    application: { influencer: { user: { name: 'Maya' } } },
  },
  {
    id: 'sc-pending',
    reviewStatus: 'PENDING',
    contentUrl: null,
    contentType: 'image',
    title: null,
    thumbnailUrl: null,
    publishedAt: null,
    reviewedAt: null,
    submittedAt: new Date('2026-01-03'),
    application: { influencer: { user: { name: 'Nina' } } },
  },
];

const SNAPSHOTS = [
  {
    submittedContentId: 'sc-approved',
    views: 1000,
    likes: 10,
    comments: 5,
    shares: 2,
    engagementRate: 1.7,
    recordedAt: new Date('2026-01-06'),
  },
];

function makeService(overrides: {
  shareLink?: any;
  campaign?: any;
} = {}) {
  const prisma: any = {
    submittedContent: { findMany: jest.fn().mockResolvedValue(CONTENTS) },
    trackingResult: { findMany: jest.fn().mockResolvedValue(SNAPSHOTS) },
    campaign: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.campaign === undefined ? CAMPAIGN : overrides.campaign,
        ),
    },
    trackingShareLink: {
      findUnique: jest.fn().mockResolvedValue(overrides.shareLink ?? null),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: 'link-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const campaigns: any = {
    getCampaign: jest.fn().mockResolvedValue(CAMPAIGN),
  };
  const service = new TrackingService(prisma, campaigns, {} as any, {} as any);
  return Object.assign(service, { __prisma: prisma, __campaigns: campaigns });
}

describe('TrackingService — share links', () => {
  it('TC-SL-01: createShareLink checks ownership and mints a future-dated token', async () => {
    const svc: any = makeService();
    const before = Date.now();
    const link = await svc.createShareLink('u-1', 'camp-1');

    expect(svc.__campaigns.getCampaign).toHaveBeenCalledWith('u-1', 'camp-1');
    expect(svc.__prisma.trackingShareLink.create).toHaveBeenCalled();
    // token is a non-trivial random string, not the campaign id
    expect(typeof link.token).toBe('string');
    expect(link.token.length).toBeGreaterThan(20);
    expect(link.token).not.toContain('camp-1');
    // finite expiry, in the future
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(before);
  });

  it('TC-SL-02: getPublicReport returns the allowlist — no id, published-only, no status/submittedAt', async () => {
    const svc: any = makeService({
      shareLink: {
        id: 'link-1',
        token: 'tok',
        campaignId: 'camp-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const report = await svc.getPublicReport('tok');

    // campaign id is dropped from the public payload
    expect(report.campaign).not.toHaveProperty('id');
    expect(report.campaign.name).toBe('Glow');
    expect(report.campaign.brandName).toBe('Acme');

    // progress still computed over the full campaign
    expect(report.progress).toEqual({
      totalDeliverables: 2,
      published: 1,
      remaining: 1,
      pctComplete: 50,
    });

    // published-only: the PENDING content is excluded
    expect(report.content).toHaveLength(1);
    const row = report.content[0];
    expect(row.id).toBe('sc-approved');
    expect(row.views).toBe(1000);
    expect(row.synced).toBe(true);
    // internal workflow fields are omitted
    expect(row).not.toHaveProperty('status');
    expect(row).not.toHaveProperty('submittedAt');
    // publish-date fallback fields are kept
    expect(row).toHaveProperty('publishedAt');
    expect(row).toHaveProperty('approvedAt');

    // best-effort last-viewed touch
    expect(svc.__prisma.trackingShareLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'link-1' } }),
    );
  });

  it('TC-SL-03: getPublicReport hides unknown / revoked / expired tokens behind one 404', async () => {
    // unknown token
    await expect(makeService().getPublicReport('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // revoked
    await expect(
      makeService({
        shareLink: {
          id: 'l',
          token: 't',
          campaignId: 'camp-1',
          revokedAt: new Date(),
          expiresAt: null,
        },
      }).getPublicReport('t'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // expired
    await expect(
      makeService({
        shareLink: {
          id: 'l',
          token: 't',
          campaignId: 'camp-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() - 60_000),
        },
      }).getPublicReport('t'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('TC-SL-04: revokeShareLink re-checks ownership then revokes; missing → NotFound', async () => {
    const svc: any = makeService({
      shareLink: { id: 'link-1', campaignId: 'camp-1' },
    });
    const res = await svc.revokeShareLink('u-1', 'link-1');

    expect(svc.__campaigns.getCampaign).toHaveBeenCalledWith('u-1', 'camp-1');
    expect(svc.__prisma.trackingShareLink.update).toHaveBeenCalledWith({
      where: { id: 'link-1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(res).toEqual({ revoked: true });

    // unknown link id
    await expect(
      makeService().revokeShareLink('u-1', 'ghost'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
