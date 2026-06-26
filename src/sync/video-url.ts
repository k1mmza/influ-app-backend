/**
 * Pure URL parsing for the tracking sync pipeline. No DB, no network, no Nest —
 * just a function and its types, so it is trivially unit-testable and reusable
 * by every platform adapter.
 *
 * Callers pass an arbitrary published `contentUrl` (it may be YouTube, TikTok,
 * Instagram, a Drive/Frame.io link, or garbage) and switch on the discriminated
 * result:
 *   - `null`                       → not something we sync; skip silently.
 *   - `{ platform: 'youtube', … }` → resolved YouTube video id.
 *   - `{ platform: 'tiktok', videoId }`            → resolved TikTok video id.
 *   - `{ platform: 'tiktok', needsResolution }`    → a TikTok short link
 *       (vm./vt.tiktok.com) whose id is only known after following the redirect.
 *       This is NOT pure-resolvable, so it is surfaced as a flag rather than a
 *       silent `null` — a caller with network access can resolve it later.
 *
 * This never throws: malformed input yields `null`, not an exception.
 */

export type ParsedVideoUrl =
  | { platform: 'youtube'; videoId: string }
  | { platform: 'tiktok'; videoId: string }
  | { platform: 'tiktok'; videoId: null; needsResolution: true };

// YouTube video IDs are exactly 11 chars from [A-Za-z0-9_-]. Validating the
// shape stops a malformed tail (e.g. youtu.be/<too-short>) from yielding a
// bogus id.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

// TikTok video IDs are numeric snowflake ids (19 digits in practice). Require a
// long all-digit run so a stray `/video/foo` path can't yield a bogus id.
const TIKTOK_ID = /^\d{15,}$/;

function asYouTube(videoId: string | null | undefined): ParsedVideoUrl | null {
  if (videoId && YOUTUBE_ID.test(videoId)) {
    return { platform: 'youtube', videoId };
  }
  return null;
}

function asTikTok(videoId: string | null | undefined): ParsedVideoUrl | null {
  if (videoId && TIKTOK_ID.test(videoId)) {
    return { platform: 'tiktok', videoId };
  }
  return null;
}

function parseYouTube(parsed: URL, host: string): ParsedVideoUrl | null {
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

  return null;
}

function parseTikTok(parsed: URL, host: string): ParsedVideoUrl | null {
  // Short links (vm.tiktok.com/ZMxxxx, vt.tiktok.com/xxxx) are opaque redirects;
  // the numeric video id is only revealed by following the 30x. We cannot do
  // that purely, so surface a resolution flag instead of a silent null.
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    return { platform: 'tiktok', videoId: null, needsResolution: true };
  }

  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    // Canonical: /@username/video/<19-digit id>  (also tolerate /video/<id>).
    const segments = parsed.pathname.split('/').filter(Boolean);
    const videoIdx = segments.indexOf('video');
    if (videoIdx !== -1) {
      return asTikTok(segments[videoIdx + 1]);
    }
    return null;
  }

  return null;
}

/**
 * Extract a video id from the supported URL forms, ignoring extra query params
 * (`&t=30s`, `?si=...`) and trailing slashes. Returns `null` for anything that
 * is not a recognizable YouTube or TikTok content URL.
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

  return parseYouTube(parsed, host) ?? parseTikTok(parsed, host);
}
