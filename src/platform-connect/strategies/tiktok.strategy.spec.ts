/**
 * TEST PLAN — TikTokStrategy.fetchVideoStats (mocked global fetch)
 * ===============================================================
 * Focus is the Phase 2 addition: create_time (Unix seconds) → publishedAt ISO.
 * The counts path already runs through the tracking sync suite; here we pin the
 * metadata parsing and the null case.
 *
 * NOTE: field presence/shape was NOT verified against a live TikTok response
 * (no dev influencer has completed TikTok Connect, so there is no OAuth token).
 * These tests assert our parsing given the documented shape — confirm the shape
 * itself on the first real connect.
 *
 * TC-01: create_time (Unix seconds) maps to an ISO publishedAt; counts parse too
 * TC-02: a missing create_time yields publishedAt = null (no throw)
 */

import { TikTokStrategy } from './tiktok.strategy';

function ttResponse(videos: any[]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: { videos } }),
  } as Response;
}

describe('TikTokStrategy.fetchVideoStats', () => {
  const strategy = new TikTokStrategy();
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('TC-01: maps create_time (Unix seconds) to an ISO publishedAt', async () => {
    // 2026-06-20T10:00:00Z === 1782000000 seconds
    const createTime = Math.floor(Date.parse('2026-06-20T10:00:00Z') / 1000);
    fetchMock.mockResolvedValueOnce(
      ttResponse([
        {
          id: '123',
          view_count: 1000,
          like_count: 30,
          comment_count: 10,
          share_count: 5,
          create_time: createTime,
        },
      ]),
    );

    const stats = await strategy.fetchVideoStats('token', ['123']);

    expect(stats.get('123')).toEqual({
      views: 1000,
      likes: 30,
      comments: 10,
      shares: 5,
      publishedAt: '2026-06-20T10:00:00.000Z',
    });
    // request must include create_time in the fields (but NOT cover_image_url)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ filters: { video_ids: ['123'] } });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('create_time');
    expect(url).not.toContain('cover_image_url');
  });

  it('TC-02: a missing create_time yields publishedAt null', async () => {
    fetchMock.mockResolvedValueOnce(
      ttResponse([
        { id: '9', view_count: 5, like_count: 1, comment_count: 0, share_count: 0 },
      ]),
    );

    const stats = await strategy.fetchVideoStats('token', ['9']);

    expect(stats.get('9')).toEqual({
      views: 5,
      likes: 1,
      comments: 0,
      shares: 0,
      publishedAt: null,
    });
  });
});
