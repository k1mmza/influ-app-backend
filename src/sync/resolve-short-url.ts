/**
 * Network-bound resolver for TikTok short links (vm./vt.tiktok.com), kept
 * SEPARATE from the pure `parseVideoUrl` parser and from the daily sync. A
 * TikTok short link is an opaque token whose canonical `/@user/video/<id>` URL
 * is only revealed by following its redirect — verified to be a single
 * `301 Moved Permanently` whose `Location` already carries the canonical path.
 *
 * This is the ONLY place a network call happens for URL resolution. It is
 * best-effort and NEVER throws: on timeout, a non-redirect, a missing/odd
 * Location, or any network error it returns `null`, and the caller leaves the
 * row holding the original short link (so the daily sync's `needsResolution`
 * skip keeps it visibly untracked rather than silently dropped).
 */

import { parseVideoUrl } from './video-url';

// Tight timeout — this runs after the (already-committed) Draft approval and
// must never make that operation feel slow. A short link that doesn't resolve
// in a couple seconds is treated as unresolved.
const RESOLVE_TIMEOUT_MS = 2500;

// TikTok resolves in a single hop, but cap follows so a misbehaving redirect
// loop can't spin. Small and finite.
const MAX_HOPS = 3;

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Follow a TikTok short link's redirect(s) and return its canonical
 * `https://www.tiktok.com/@user/video/<id>` URL (query string stripped), or
 * `null` if it can't be resolved. Uses a HEAD request with manual redirect
 * handling so we read each `Location` ourselves and cap the number of hops.
 */
export async function resolveTikTokShortLink(
  shortUrl: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

  try {
    let url = shortUrl;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });

      // Not a redirect — nothing more to follow, and we never reached a
      // canonical video URL. Give up (best-effort).
      if (!REDIRECT_CODES.has(res.status)) return null;

      const location = res.headers.get('location');
      if (!location) return null;

      // Resolve relative Locations against the current URL; tolerate junk.
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return null;
      }

      // Did this hop land on a canonical TikTok video URL? Reuse the pure
      // parser as the source of truth for "is this a real video id".
      const parsed = parseVideoUrl(next.toString());
      if (parsed && parsed.platform === 'tiktok' && parsed.videoId !== null) {
        // Store the clean canonical form (no _t/_r tracking params).
        return `${next.origin}${next.pathname}`;
      }

      url = next.toString();
    }
    return null; // exhausted hops without reaching a canonical video URL
  } catch {
    // Timeout/abort/DNS/connection error — best-effort, no throw.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
