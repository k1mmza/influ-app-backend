/**
 * Pure URL parsing for the tracking sync pipeline. No DB, no network, no Nest —
 * just a function and its types, so it is trivially unit-testable and reusable
 * by every platform adapter.
 *
 * Tier 1.5 is YouTube-only: callers pass an arbitrary published `contentUrl`
 * (it may be TikTok, Instagram, a Drive/Frame.io link, or garbage) and use a
 * `null` return as the "not something we sync — skip silently" signal. Hence
 * this never throws: malformed input yields `null`, not an exception.
 */

export type ParsedVideoUrl = { platform: 'youtube'; videoId: string };

// YouTube video IDs are exactly 11 chars from [A-Za-z0-9_-]. Validating the
// shape stops a malformed tail (e.g. youtu.be/<too-short>) from yielding a
// bogus id.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function asYouTube(videoId: string | null | undefined): ParsedVideoUrl | null {
  if (videoId && YOUTUBE_ID.test(videoId)) {
    return { platform: 'youtube', videoId };
  }
  return null;
}

/**
 * Extract a YouTube video id from the supported URL forms, ignoring any extra
 * query params (`&t=30s`, `?si=...`) and trailing slashes. Returns `null` for
 * anything that is not a recognizable YouTube watch/short/youtu.be URL.
 */
export function parseVideoUrl(url: string): ParsedVideoUrl | null {
  if (typeof url !== 'string' || url.trim() === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    // Not a valid absolute URL — nothing to sync.
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

  // youtu.be/VIDEOID  → id is the first path segment
  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return asYouTube(id);
  }

  // youtube.com (incl. m. and music.) — watch?v= and /shorts/VIDEOID
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (parsed.pathname === '/watch') {
      return asYouTube(parsed.searchParams.get('v'));
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] === 'shorts') {
      return asYouTube(segments[1]);
    }
    return null;
  }

  // Anything else (TikTok, Instagram, Drive, Frame.io, …) is not ours.
  return null;
}
