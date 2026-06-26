/**
 * TEST PLAN — resolveTikTokShortLink (network-bound, fetch mocked)
 * ===============================================================
 * The verified real-world shape is a single 301 whose Location is the canonical
 * /@user/video/<id>. These lock that path plus the best-effort failure modes —
 * the resolver must NEVER throw; every failure returns null.
 *
 * RS-01: a single 301 -> canonical URL returns the cleaned canonical (params stripped)
 * RS-02: a redirect chain that reaches the canonical at a later hop resolves it
 * RS-03: a 200 (no redirect) returns null
 * RS-04: a 301 with no Location header returns null
 * RS-05: a redirect to a non-video TikTok URL (interstitial) returns null
 * RS-06: more than MAX_HOPS redirects without a canonical URL returns null
 * RS-07: a network error / timeout (fetch rejects) returns null, never throws
 */

import { resolveTikTokShortLink } from './resolve-short-url';

const SHORT = 'https://vt.tiktok.com/ZSCjqmRBm/';
const CANON =
  'https://www.tiktok.com/@suzaki65/video/7653513498894322960?_r=1&_t=ZS-x';
const CANON_CLEAN =
  'https://www.tiktok.com/@suzaki65/video/7653513498894322960';

function redirect(location: string | null, status = 301) {
  return {
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'location' ? location : null) },
  };
}
function ok() {
  return { status: 200, headers: { get: () => null } };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveTikTokShortLink', () => {
  it('RS-01: single 301 to a canonical URL returns the cleaned canonical', async () => {
    const fetchMock = jest.fn().mockResolvedValue(redirect(CANON));
    (global as any).fetch = fetchMock;

    const out = await resolveTikTokShortLink(SHORT);

    expect(out).toBe(CANON_CLEAN); // _r/_t tracking params stripped
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // HEAD + manual redirect handling (we read Location ourselves)
    expect(fetchMock).toHaveBeenCalledWith(
      SHORT,
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
    );
  });

  it('RS-02: a chain reaching the canonical at a later hop resolves it', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(redirect('https://vt.tiktok.com/hop2/', 302))
      .mockResolvedValueOnce(redirect(CANON, 301));
    (global as any).fetch = fetchMock;

    expect(await resolveTikTokShortLink(SHORT)).toBe(CANON_CLEAN);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('RS-03: a 200 (no redirect) returns null', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(ok());
    expect(await resolveTikTokShortLink(SHORT)).toBeNull();
  });

  it('RS-04: a 301 with no Location returns null', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(redirect(null));
    expect(await resolveTikTokShortLink(SHORT)).toBeNull();
  });

  it('RS-05: a redirect to a non-video TikTok URL (interstitial) returns null', async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(redirect('https://www.tiktok.com/?_r=1'));
    expect(await resolveTikTokShortLink(SHORT)).toBeNull();
  });

  it('RS-06: more redirects than MAX_HOPS without a canonical returns null', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(redirect('https://vt.tiktok.com/loop/', 302));
    (global as any).fetch = fetchMock;

    expect(await resolveTikTokShortLink(SHORT)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3); // capped at MAX_HOPS
  });

  it('RS-07: a network error / timeout returns null and never throws', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('aborted'));
    await expect(resolveTikTokShortLink(SHORT)).resolves.toBeNull();
  });
});
