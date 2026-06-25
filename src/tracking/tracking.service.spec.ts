/**
 * TEST PLAN — TrackingService
 * ===========================
 * The non-trivial bit is latest-snapshot-per-content dedup (input is recordedAt desc,
 * first seen wins). Hand-rolled prisma/campaigns mocks.
 *
 * TC-01: getDetail keeps only the latest snapshot per submittedContent
 * TC-02: getSummary sums/averages over latest snapshots only (not every snapshot)
 */

import { TrackingService } from './tracking.service';

function makeService(trackingRows: any[], campaigns: any[]) {
  const prisma: any = {
    trackingResult: { findMany: jest.fn().mockResolvedValue(trackingRows) },
  };
  const campaignsService: any = {
    getCampaignsForUser: jest.fn().mockResolvedValue(campaigns),
    getCampaign: jest.fn().mockResolvedValue(campaigns[0]),
  };
  return new TrackingService(prisma, campaignsService);
}

// two snapshots for content c1 (newer first), one for c2
const detailRows = [
  {
    id: 'tr-2', submittedContentId: 'c1', recordedAt: new Date('2026-02-01'),
    views: 200, likes: 0, comments: 0, shares: 0, engagementRate: 5,
    influencer: { growthRate: 8, user: { name: 'Maya' }, platformAccounts: [{ platform: 'tiktok', isPrimary: true }] },
    submittedContent: { contentType: 'video', contentUrl: 'http://x' },
  },
  {
    id: 'tr-1', submittedContentId: 'c1', recordedAt: new Date('2026-01-01'),
    views: 100, likes: 0, comments: 0, shares: 0, engagementRate: 3,
    influencer: { growthRate: 8, user: { name: 'Maya' }, platformAccounts: [{ platform: 'tiktok', isPrimary: true }] },
    submittedContent: { contentType: 'video', contentUrl: 'http://x' },
  },
  {
    id: 'tr-3', submittedContentId: 'c2', recordedAt: new Date('2026-02-01'),
    views: 50, likes: 0, comments: 0, shares: 0, engagementRate: 7,
    influencer: { growthRate: 2, user: { name: 'Nina' }, platformAccounts: [] },
    submittedContent: { contentType: 'image', contentUrl: null },
  },
];

describe('TrackingService', () => {
  it('TC-01: getDetail returns one row per content, using the latest snapshot', async () => {
    const svc = makeService(detailRows, [{ id: 'camp-1' }]);
    const rows = await svc.getDetail('u-1', 'camp-1');

    expect(rows).toHaveLength(2);
    const c1 = rows.find((r) => r.id === 'tr-2');
    expect(c1).toBeDefined(); // newer snapshot kept
    expect(rows.find((r) => r.id === 'tr-1')).toBeUndefined(); // older dropped
    expect(c1!.views).toBe(200);
    expect(c1!.platform).toBe('tiktok');
    expect(c1!.growthRate).toBe(8);
  });

  it('TC-02: getSummary aggregates latest snapshots only', async () => {
    const summaryRows = detailRows.map((r) => ({
      campaignId: 'camp-1', submittedContentId: r.submittedContentId,
      influencerId: r.influencer.user.name, views: r.views, engagementRate: r.engagementRate,
    }));
    const svc = makeService(summaryRows, [{ id: 'camp-1', name: 'Glow', status: 'ACTIVE' }]);
    const [summary] = await svc.getSummary('u-1');

    expect(summary.totalViews).toBe(250); // 200 (latest c1) + 50 (c2), NOT 100
    expect(summary.avgEngagementRate).toBe(6); // (5 + 7) / 2
    expect(summary.influencerCount).toBe(2);
  });
});
