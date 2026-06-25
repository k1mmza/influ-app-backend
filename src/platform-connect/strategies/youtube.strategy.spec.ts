/**
 * TEST PLAN — YouTubeStrategy.fetchVideoStats (mocked global fetch)
 * ================================================================
 * TC-01: a 2-item batch maps each id to parsed views/likes/comments,
 *        with a hidden like count defaulting to 0 (one call)
 * TC-02: a >50-id batch chunks into 50 + remainder → exactly 2 fetch calls
 * TC-03: a video returning no item is simply absent from the Map (no throw)
 */

import { YouTubeStrategy } from './youtube.strategy';

// Build a mock videos.list Response carrying the given items.
function ytResponse(items: any[]) {
  return { ok: true, json: () => Promise.resolve({ items }) } as Response;
}

// Parse the comma-joined id list out of a videos.list request URL.
function idsFromCall(url: string): string[] {
  const raw = new URL(url).searchParams.get('id') ?? '';
  return raw ? raw.split(',') : [];
}

describe('YouTubeStrategy.fetchVideoStats', () => {
  const strategy = new YouTubeStrategy();
  let fetchMock: jest.Mock;

  beforeAll(() => {
    process.env.YOUTUBE_API_KEY = 'test-key';
  });
  afterAll(() => {
    delete process.env.YOUTUBE_API_KEY;
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('TC-01: maps a 2-item batch, defaulting a hidden like count to 0', async () => {
    fetchMock.mockResolvedValueOnce(
      ytResponse([
        {
          id: 'vid-a',
          statistics: { viewCount: '1000', likeCount: '120', commentCount: '8' },
        },
        // likeCount hidden by the creator — must default to 0, not throw.
        { id: 'vid-b', statistics: { viewCount: '50', commentCount: '2' } },
      ]),
    );

    const stats = await strategy.fetchVideoStats(['vid-a', 'vid-b']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stats.get('vid-a')).toEqual({ views: 1000, likes: 120, comments: 8 });
    expect(stats.get('vid-b')).toEqual({ views: 50, likes: 0, comments: 2 });
    // sanity: request used videos.list with part=statistics,snippet
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/videos?part=statistics,snippet');
  });

  it('TC-02: chunks a >50-id batch into exactly 2 calls (50 + remainder)', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    fetchMock.mockResolvedValue(ytResponse([])); // contents irrelevant here

    await strategy.fetchVideoStats(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(idsFromCall(fetchMock.mock.calls[0][0] as string)).toHaveLength(50);
    expect(idsFromCall(fetchMock.mock.calls[1][0] as string)).toHaveLength(1);
  });

  it('TC-03: a video that returns no item is absent from the Map', async () => {
    // Asked for two ids; the API only returns one (the other is deleted/private).
    fetchMock.mockResolvedValueOnce(
      ytResponse([
        { id: 'live', statistics: { viewCount: '7', likeCount: '1', commentCount: '0' } },
      ]),
    );

    const stats = await strategy.fetchVideoStats(['live', 'gone']);

    expect(stats.size).toBe(1);
    expect(stats.has('gone')).toBe(false);
    expect(stats.get('live')).toEqual({ views: 7, likes: 1, comments: 0 });
  });
});
