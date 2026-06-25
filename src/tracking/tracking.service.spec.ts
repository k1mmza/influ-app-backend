/**
 * TEST PLAN — TrackingService
 * ===========================
 * The non-trivial bit is latest-snapshot-per-content dedup (input is recordedAt desc,
 * first seen wins). Hand-rolled prisma/campaigns mocks.
 *
 * TC-01: getDetail keeps only the latest snapshot per submittedContent
 * TC-02: getSummary sums/averages over latest snapshots only (not every snapshot)
 *
 * Canonical write path (recordSnapshot) — the single TrackingResult writer
 * --------------------------------------------------------------------------
 * TC-03: recordResult derives influencerId from the application, not the client
 * TC-04: recordResult rejects content whose application is for another campaign
 * TC-05: recordSnapshot writes the given ids verbatim and defaults metrics to 0
 * TC-06: recordSnapshot upserts on the natural key when given recordedAt + period
 *
 * YouTube sync (syncYoutubeStats) — parseVideoUrl real, fetch + recordSnapshot mocked
 * -----------------------------------------------------------------------------------
 * TC-07: a YouTube content writes a snapshot with resolved ids + computed ER%
 * TC-08: a TikTok content is skipped (no fetch, no write)
 * TC-09: a zero-view video yields ER 0 (no divide-by-zero)
 * TC-10: a video absent from the fetch (deleted/private) counts as skipped
 */

import { NotFoundException } from '@nestjs/common';
import { TrackingService } from './tracking.service';

function makeService(
  trackingRows: any[],
  campaigns: any[],
  submittedContent: any = undefined,
  opts: { candidates?: any[]; youtube?: any } = {},
) {
  const prisma: any = {
    trackingResult: {
      findMany: jest.fn().mockResolvedValue(trackingRows),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'tr-new', ...data })),
      upsert: jest.fn().mockImplementation(({ create }) => ({ id: 'tr-up', ...create })),
    },
    submittedContent: {
      findUnique: jest.fn().mockResolvedValue(submittedContent),
      findMany: jest.fn().mockResolvedValue(opts.candidates ?? []),
    },
  };
  const campaignsService: any = {
    getCampaignsForUser: jest.fn().mockResolvedValue(campaigns),
    getCampaign: jest.fn().mockResolvedValue(campaigns[0]),
  };
  const youtube: any = opts.youtube ?? {
    fetchVideoStats: jest.fn().mockResolvedValue(new Map()),
  };
  const service = new TrackingService(prisma, campaignsService, youtube);
  return Object.assign(service, { __prisma: prisma, __youtube: youtube });
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

  it('TC-03: recordResult derives influencerId from the application, not the client', async () => {
    const content = {
      id: 'sc-1',
      application: { campaignId: 'camp-1', influencerId: 'inf-trusted' },
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], content);
    await svc.recordResult('u-1', 'camp-1', {
      submittedContentId: 'sc-1',
      influencerId: 'inf-SPOOFED', // ignored — not in the DTO/write
      views: 1234,
    });

    expect(svc.__prisma.trackingResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: 'camp-1',
          influencerId: 'inf-trusted',
          submittedContentId: 'sc-1',
          views: 1234,
          likes: 0, // omitted metrics default to 0
        }),
      }),
    );
  });

  it('TC-04: recordResult rejects content whose application is for another campaign', async () => {
    const content = {
      id: 'sc-1',
      application: { campaignId: 'OTHER-camp', influencerId: 'inf-1' },
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], content);
    await expect(
      svc.recordResult('u-1', 'camp-1', { submittedContentId: 'sc-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(svc.__prisma.trackingResult.create).not.toHaveBeenCalled();
  });

  it('TC-05: recordSnapshot writes the given ids verbatim and defaults metrics to 0', async () => {
    const svc: any = makeService([], [{ id: 'camp-1' }]);
    const row = await svc.recordSnapshot({
      campaignId: 'camp-1',
      influencerId: 'inf-1',
      submittedContentId: 'sc-1',
      views: 500,
      // likes/comments/shares/engagementRate omitted
    });
    expect(svc.__prisma.trackingResult.create).toHaveBeenCalledWith({
      data: {
        campaignId: 'camp-1',
        influencerId: 'inf-1',
        submittedContentId: 'sc-1',
        views: 500,
        likes: 0,
        comments: 0,
        shares: 0,
        engagementRate: 0,
        snapshotPeriod: undefined,
      },
    });
    expect(row.id).toBe('tr-new');
  });

  it('TC-06: recordSnapshot upserts on the natural key when given recordedAt + period', async () => {
    const svc: any = makeService([], [{ id: 'camp-1' }]);
    const recordedAt = new Date('2026-06-25T00:00:00.000Z');
    await svc.recordSnapshot({
      campaignId: 'camp-1',
      influencerId: 'inf-1',
      submittedContentId: 'sc-1',
      views: 10,
      snapshotPeriod: 'DAILY',
      recordedAt,
    });
    expect(svc.__prisma.trackingResult.create).not.toHaveBeenCalled();
    expect(svc.__prisma.trackingResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          submittedContentId_recordedAt_snapshotPeriod: {
            submittedContentId: 'sc-1',
            recordedAt,
            snapshotPeriod: 'DAILY',
          },
        },
        update: expect.objectContaining({ views: 10 }),
      }),
    );
  });

  it('TC-07: a YouTube content writes a snapshot with resolved ids and computed ER%', async () => {
    const candidates = [
      {
        id: 'sc-yt',
        contentUrl: 'https://youtu.be/dQw4w9WgXcQ',
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const youtube = {
      fetchVideoStats: jest.fn().mockResolvedValue(
        new Map([['dQw4w9WgXcQ', { views: 1000, likes: 40, comments: 10 }]]),
      ),
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      youtube,
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncYoutubeStats();

    expect(youtube.fetchVideoStats).toHaveBeenCalledWith(['dQw4w9WgXcQ']);
    expect(rec).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp-1',
        influencerId: 'inf-1',
        submittedContentId: 'sc-yt',
        views: 1000,
        likes: 40,
        comments: 10,
        shares: 0,
        engagementRate: 5, // (40 + 10) / 1000 * 100 = 5.0 (percent unit)
        snapshotPeriod: 'DAILY',
      }),
    );
    // recordedAt floored to 00:00:00Z
    const arg = rec.mock.calls[0][0] as any;
    expect(arg.recordedAt.getUTCHours()).toBe(0);
    expect(arg.recordedAt.getUTCMinutes()).toBe(0);
    expect(arg.recordedAt.getUTCSeconds()).toBe(0);
    expect(arg.recordedAt.getUTCMilliseconds()).toBe(0);
    expect(res).toEqual({ written: 1, skipped: 0 });
  });

  it('TC-08: a non-YouTube (TikTok) content is skipped', async () => {
    const candidates = [
      {
        id: 'sc-tt',
        contentUrl: 'https://www.tiktok.com/@x/video/123',
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const youtube = { fetchVideoStats: jest.fn() };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      youtube,
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncYoutubeStats();

    expect(youtube.fetchVideoStats).not.toHaveBeenCalled(); // no YouTube ids collected
    expect(rec).not.toHaveBeenCalled();
    expect(res).toEqual({ written: 0, skipped: 1 });
  });

  it('TC-09: a zero-view video yields ER 0 (no divide-by-zero)', async () => {
    const candidates = [
      {
        id: 'sc-yt',
        contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const youtube = {
      fetchVideoStats: jest.fn().mockResolvedValue(
        new Map([['dQw4w9WgXcQ', { views: 0, likes: 0, comments: 0 }]]),
      ),
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      youtube,
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncYoutubeStats();

    expect(rec).toHaveBeenCalledWith(
      expect.objectContaining({ views: 0, engagementRate: 0 }),
    );
    expect(res).toEqual({ written: 1, skipped: 0 });
  });

  it('TC-10: a video absent from the fetch (deleted/private) counts as skipped', async () => {
    const candidates = [
      {
        id: 'sc-yt',
        contentUrl: 'https://youtu.be/dQw4w9WgXcQ',
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const youtube = {
      fetchVideoStats: jest.fn().mockResolvedValue(new Map()), // id requested, none returned
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      youtube,
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncYoutubeStats();

    expect(rec).not.toHaveBeenCalled();
    expect(res).toEqual({ written: 0, skipped: 1 });
  });
});
