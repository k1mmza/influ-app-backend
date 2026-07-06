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
 *
 * TikTok sync (syncTiktokStats) — parseVideoUrl real, per-influencer token fetch mocked
 * --------------------------------------------------------------------------------------
 * TC-11: a TikTok content for a connected account writes a snapshot (real shares, ER incl. shares)
 * TC-12: an influencer with NO connected TikTok is skipped (no write, nothing to flag)
 * TC-13: a failed token refresh skips the influencer AND sets needsReauth (skip-and-flag)
 * TC-14: a TikTokAuthError (missing video.list scope) skips AND sets needsReauth
 * TC-15: a video absent from the fetch (deleted/private/not-owned) counts as skipped
 *
 * Client report (getReport) — composed payload for the presentation page
 * ----------------------------------------------------------------------
 * TC-16: badges are suppressed when the campaign has < 2 synced items
 * TC-17: each badge (above_average/trending/high_engagement/none) derives from the campaign average
 * TC-18: unsynced content passes through null metrics (not fabricated zeros)
 * TC-19: completion clamps to 100% when published exceeds accepted deliverables
 * TC-20: platform is derived from the content URL, not the influencer's account
 */

import { NotFoundException } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TikTokAuthError } from '../platform-connect/strategies/tiktok.strategy';

// valid 19-digit TikTok snowflake id (matches parseVideoUrl's ^\d{15,}$)
const TT_ID = '7234567890123456789';
const TT_URL = `https://www.tiktok.com/@creator/video/${TT_ID}`;
const future = new Date(Date.now() + 60 * 60 * 1000); // token not near expiry

function makeService(
  trackingRows: any[],
  campaigns: any[],
  submittedContent: any = undefined,
  opts: {
    candidates?: any[];
    youtube?: any;
    tiktok?: any;
    platformAccount?: any;
  } = {},
) {
  const prisma: any = {
    trackingResult: {
      findMany: jest.fn().mockResolvedValue(trackingRows),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: 'tr-new', ...data })),
      upsert: jest
        .fn()
        .mockImplementation(({ create }) => ({ id: 'tr-up', ...create })),
    },
    submittedContent: {
      findUnique: jest.fn().mockResolvedValue(submittedContent),
      findMany: jest.fn().mockResolvedValue(opts.candidates ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    platformAccount: {
      // default: no connected account (overridable per test)
      findFirst: jest.fn().mockResolvedValue(opts.platformAccount ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const campaignsService: any = {
    getCampaignsForUser: jest.fn().mockResolvedValue(campaigns),
    getCampaign: jest.fn().mockResolvedValue(campaigns[0]),
  };
  const youtube: any = opts.youtube ?? {
    fetchVideoStats: jest.fn().mockResolvedValue(new Map()),
  };
  const tiktok: any = opts.tiktok ?? {
    fetchVideoStats: jest.fn().mockResolvedValue(new Map()),
    refreshAccessToken: jest.fn(),
  };
  const service = new TrackingService(
    prisma,
    campaignsService,
    youtube,
    tiktok,
  );
  return Object.assign(service, {
    __prisma: prisma,
    __youtube: youtube,
    __tiktok: tiktok,
  });
}

// two snapshots for content c1 (newer first), one for c2
const detailRows = [
  {
    id: 'tr-2',
    submittedContentId: 'c1',
    recordedAt: new Date('2026-02-01'),
    views: 200,
    likes: 0,
    comments: 0,
    shares: 0,
    engagementRate: 5,
    influencer: {
      growthRate: 8,
      user: { name: 'Maya' },
      platformAccounts: [{ platform: 'tiktok', isPrimary: true }],
    },
    submittedContent: { contentType: 'video', contentUrl: 'http://x' },
  },
  {
    id: 'tr-1',
    submittedContentId: 'c1',
    recordedAt: new Date('2026-01-01'),
    views: 100,
    likes: 0,
    comments: 0,
    shares: 0,
    engagementRate: 3,
    influencer: {
      growthRate: 8,
      user: { name: 'Maya' },
      platformAccounts: [{ platform: 'tiktok', isPrimary: true }],
    },
    submittedContent: { contentType: 'video', contentUrl: 'http://x' },
  },
  {
    id: 'tr-3',
    submittedContentId: 'c2',
    recordedAt: new Date('2026-02-01'),
    views: 50,
    likes: 0,
    comments: 0,
    shares: 0,
    engagementRate: 7,
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
      campaignId: 'camp-1',
      submittedContentId: r.submittedContentId,
      influencerId: r.influencer.user.name,
      views: r.views,
      engagementRate: r.engagementRate,
    }));
    const svc = makeService(summaryRows, [
      { id: 'camp-1', name: 'Glow', status: 'ACTIVE' },
    ]);
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
      fetchVideoStats: jest
        .fn()
        .mockResolvedValue(
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
      fetchVideoStats: jest
        .fn()
        .mockResolvedValue(
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

  it('TC-10b: syncYoutubeStats writes thumbnail + publishedAt once, never overwriting', async () => {
    const candidates = [
      // no metadata yet → both fields should be written
      {
        id: 'sc-new',
        contentUrl: 'https://youtu.be/dQw4w9WgXcQ',
        thumbnailUrl: null,
        publishedAt: null,
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
      // already populated → must NOT be overwritten
      {
        id: 'sc-old',
        contentUrl: 'https://youtu.be/AAAAAAAAAAA',
        thumbnailUrl: 'http://old.jpg',
        publishedAt: new Date('2020-01-01'),
        application: { campaignId: 'camp-1', influencerId: 'inf-2' },
      },
    ];
    const youtube = {
      fetchVideoStats: jest.fn().mockResolvedValue(
        new Map([
          [
            'dQw4w9WgXcQ',
            { views: 100, likes: 5, comments: 1, thumbnailUrl: 'http://new.jpg', publishedAt: '2026-06-20T10:00:00Z' },
          ],
          [
            'AAAAAAAAAAA',
            { views: 200, likes: 9, comments: 2, thumbnailUrl: 'http://fresh.jpg', publishedAt: '2026-06-21T10:00:00Z' },
          ],
        ]),
      ),
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      youtube,
    });
    jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    await svc.syncYoutubeStats();

    const upd = svc.__prisma.submittedContent.update;
    expect(upd).toHaveBeenCalledTimes(1); // only the metadata-less row
    expect(upd).toHaveBeenCalledWith({
      where: { id: 'sc-new' },
      data: {
        thumbnailUrl: 'http://new.jpg',
        publishedAt: new Date('2026-06-20T10:00:00Z'),
      },
    });
  });

  it('TC-11: a TikTok content for a connected account writes a snapshot with real shares', async () => {
    const candidates = [
      {
        id: 'sc-tt',
        contentUrl: TT_URL,
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const tiktok = {
      fetchVideoStats: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [TT_ID, { views: 1000, likes: 30, comments: 10, shares: 10 }],
          ]),
        ),
      refreshAccessToken: jest.fn(),
    };
    const account = {
      id: 'pa-1',
      accessToken: 'at',
      refreshToken: 'rt',
      tokenExpiry: future,
      needsReauth: false,
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      tiktok,
      platformAccount: account,
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncTiktokStats();

    expect(tiktok.refreshAccessToken).not.toHaveBeenCalled(); // token not expired
    expect(tiktok.fetchVideoStats).toHaveBeenCalledWith('at', [TT_ID]);
    expect(rec).toHaveBeenCalledWith(
      expect.objectContaining({
        submittedContentId: 'sc-tt',
        views: 1000,
        likes: 30,
        comments: 10,
        shares: 10, // real, unlike YouTube
        engagementRate: 5, // (30 + 10 + 10) / 1000 * 100 = 5.0 (incl. shares)
        snapshotPeriod: 'DAILY',
      }),
    );
    expect(res).toEqual({ written: 1, skipped: 0, reauth: 0 });
  });

  it('TC-12: an influencer with no connected TikTok is skipped, nothing to flag', async () => {
    const candidates = [
      {
        id: 'sc-tt',
        contentUrl: TT_URL,
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      platformAccount: null, // no connected account
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncTiktokStats();

    expect(rec).not.toHaveBeenCalled();
    expect(svc.__prisma.platformAccount.update).not.toHaveBeenCalled(); // no account to flag
    expect(res).toEqual({ written: 0, skipped: 1, reauth: 0 });
  });

  it('TC-13: a failed token refresh skips the influencer and sets needsReauth', async () => {
    const candidates = [
      {
        id: 'sc-tt',
        contentUrl: TT_URL,
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const tiktok = {
      fetchVideoStats: jest.fn(),
      refreshAccessToken: jest
        .fn()
        .mockRejectedValue(new Error('invalid_grant')),
    };
    const account = {
      id: 'pa-1',
      accessToken: 'at',
      refreshToken: 'rt',
      tokenExpiry: new Date(Date.now() - 1000), // expired -> forces refresh
      needsReauth: false,
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      tiktok,
      platformAccount: account,
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncTiktokStats();

    expect(tiktok.fetchVideoStats).not.toHaveBeenCalled(); // never reached fetch
    expect(rec).not.toHaveBeenCalled();
    expect(svc.__prisma.platformAccount.update).toHaveBeenCalledWith({
      where: { id: 'pa-1' },
      data: { needsReauth: true },
    });
    expect(res).toEqual({ written: 0, skipped: 1, reauth: 1 });
  });

  it('TC-14: a TikTokAuthError (missing video.list scope) skips and sets needsReauth', async () => {
    const candidates = [
      {
        id: 'sc-tt',
        contentUrl: TT_URL,
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const tiktok = {
      fetchVideoStats: jest
        .fn()
        .mockRejectedValue(new TikTokAuthError('scope_not_authorized')),
      refreshAccessToken: jest.fn(),
    };
    const account = {
      id: 'pa-1',
      accessToken: 'at',
      refreshToken: 'rt',
      tokenExpiry: future,
      needsReauth: false,
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      tiktok,
      platformAccount: account,
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncTiktokStats();

    expect(rec).not.toHaveBeenCalled();
    expect(svc.__prisma.platformAccount.update).toHaveBeenCalledWith({
      where: { id: 'pa-1' },
      data: { needsReauth: true },
    });
    expect(res).toEqual({ written: 0, skipped: 1, reauth: 1 });
  });

  it('TC-15: a TikTok video absent from the fetch counts as skipped (no flag)', async () => {
    const candidates = [
      {
        id: 'sc-tt',
        contentUrl: TT_URL,
        application: { campaignId: 'camp-1', influencerId: 'inf-1' },
      },
    ];
    const tiktok = {
      fetchVideoStats: jest.fn().mockResolvedValue(new Map()), // id requested, none owned/returned
      refreshAccessToken: jest.fn(),
    };
    const account = {
      id: 'pa-1',
      accessToken: 'at',
      refreshToken: 'rt',
      tokenExpiry: future,
      needsReauth: false,
    };
    const svc: any = makeService([], [{ id: 'camp-1' }], undefined, {
      candidates,
      tiktok,
      platformAccount: account,
    });
    const rec = jest.spyOn(svc, 'recordSnapshot').mockResolvedValue({} as any);

    const res = await svc.syncTiktokStats();

    expect(rec).not.toHaveBeenCalled();
    // reached the API fine — this is per-video absence, not an auth problem
    expect(svc.__prisma.platformAccount.update).not.toHaveBeenCalled();
    expect(res).toEqual({ written: 0, skipped: 1, reauth: 0 });
  });
});

describe('TrackingService.getReport', () => {
  // Factories keyed to the makeService mock shape:
  //   submittedContent.findMany -> opts.candidates ;  trackingResult.findMany -> trackingRows
  const content = (over: any = {}) => ({
    id: 'sc',
    contentType: 'video',
    contentUrl: 'https://youtu.be/dQw4w9WgXcQ',
    reviewStatus: 'APPROVED',
    reviewedAt: new Date('2026-06-20'),
    submittedAt: new Date('2026-06-19'),
    application: { influencer: { user: { name: 'Maya' } } },
    ...over,
  });
  const snap = (submittedContentId: string, over: any = {}) => ({
    submittedContentId,
    views: 100,
    likes: 5,
    comments: 1,
    shares: 0,
    engagementRate: 5,
    recordedAt: new Date('2026-06-20'),
    ...over,
  });
  const camp = (applications: any[]) => [
    { id: 'camp-1', name: 'Glow', status: 'ACTIVE', applications },
  ];

  it('TC-16: suppresses badges when the campaign has fewer than 2 synced items', async () => {
    const contents = [content({ id: 'sc1' })];
    // Extreme numbers that would "win" any average — proves suppression is about
    // COUNT, not value: with one item, avg === value so the badge is meaningless.
    const snaps = [snap('sc1', { views: 999, engagementRate: 99 })];
    const svc: any = makeService(snaps, camp([{ status: 'ACCEPTED' }]), undefined, {
      candidates: contents,
    });
    const report = await svc.getReport('u-1', 'camp-1');
    expect(report.content).toHaveLength(1);
    expect(report.content[0].synced).toBe(true);
    expect(report.content[0].badges).toEqual([]);
  });

  it('TC-17: computes each badge from the campaign average once >= 2 synced items', async () => {
    const contents = ['A', 'B', 'C', 'D'].map((id) => content({ id }));
    // avgViews = 620/4 = 155 ; avgEr = 24/4 = 6
    const snaps = [
      snap('A', { views: 300, engagementRate: 9 }), // both above  -> above_average
      snap('B', { views: 60, engagementRate: 3 }), //  both below  -> none
      snap('C', { views: 200, engagementRate: 3 }), // views only  -> trending
      snap('D', { views: 60, engagementRate: 9 }), //  ER only     -> high_engagement
    ];
    const svc: any = makeService(snaps, camp([{ status: 'ACCEPTED' }]), undefined, {
      candidates: contents,
    });
    const report = await svc.getReport('u-1', 'camp-1');
    const byId = Object.fromEntries(
      report.content.map((c: any) => [c.id, c.badges]),
    );
    expect(byId.A).toEqual(['above_average']);
    expect(byId.B).toEqual([]);
    expect(byId.C).toEqual(['trending']);
    expect(byId.D).toEqual(['high_engagement']);
  });

  it('TC-18: unsynced content passes through null metrics, not fabricated zeros', async () => {
    const contents = [content({ id: 'synced' }), content({ id: 'unsynced' })];
    const snaps = [
      snap('synced', {
        views: 500,
        likes: 20,
        comments: 5,
        shares: 2,
        engagementRate: 5.4,
      }),
    ];
    const svc: any = makeService(
      snaps,
      camp([{ status: 'ACCEPTED' }, { status: 'ACCEPTED' }]),
      undefined,
      { candidates: contents },
    );
    const report = await svc.getReport('u-1', 'camp-1');
    const un = report.content.find((c: any) => c.id === 'unsynced');
    const syn = report.content.find((c: any) => c.id === 'synced');

    expect(un.synced).toBe(false);
    expect(un.views).toBeNull();
    expect(un.likes).toBeNull();
    expect(un.comments).toBeNull();
    expect(un.shares).toBeNull();
    expect(un.engagementRate).toBeNull();
    expect(un.recordedAt).toBeNull();

    expect(syn.synced).toBe(true);
    expect(syn.views).toBe(500);
    // Rollup + lastUpdated reflect SYNCED content only (unsynced adds nothing).
    expect(report.summary.totalViews).toBe(500);
    expect(report.lastUpdated).toEqual(new Date('2026-06-20'));
  });

  it('TC-19: clamps completion to 100% when published exceeds accepted deliverables', async () => {
    // 1 ACCEPTED slot but 2 approved posts (a creator can publish many). Also
    // confirms only ACCEPTED applications count toward deliverables.
    const contents = [content({ id: 'p1' }), content({ id: 'p2' })];
    const snaps = [snap('p1'), snap('p2')];
    const svc: any = makeService(
      snaps,
      camp([{ status: 'ACCEPTED' }, { status: 'PENDING' }, { status: 'REJECTED' }]),
      undefined,
      { candidates: contents },
    );
    const report = await svc.getReport('u-1', 'camp-1');
    expect(report.progress.totalDeliverables).toBe(1); // only ACCEPTED counted
    expect(report.progress.published).toBe(2); // raw, not clamped
    expect(report.progress.remaining).toBe(0); // max(0, 1 - 2)
    expect(report.progress.pctComplete).toBe(100); // clamped from 200
  });

  it('TC-20: derives platform from the content URL, not the primary account', async () => {
    const contents = [
      content({ id: 'tt', contentUrl: 'https://tiktok.com/@x/video/mock1' }),
      content({ id: 'ig', contentUrl: 'https://instagram.com/p/abc' }),
      content({ id: 'nope', contentUrl: 'https://drive.google.com/file/d/xyz' }),
    ];
    const svc: any = makeService([], camp([{ status: 'ACCEPTED' }]), undefined, {
      candidates: contents,
    });
    const report = await svc.getReport('u-1', 'camp-1');
    const byId = Object.fromEntries(
      report.content.map((c: any) => [c.id, c.platform]),
    );
    expect(byId.tt).toBe('tiktok'); // invalid id, host still classifies it
    expect(byId.ig).toBe('instagram');
    expect(byId.nope).toBeNull(); // unknown host -> honest blank, not a guess
  });
});
