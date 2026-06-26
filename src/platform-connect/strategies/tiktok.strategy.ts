import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type {
  IPlatformStrategy,
  PlatformTokens,
  PlatformChannelData,
  PlatformAnalyticsData,
} from './platform-strategy.interface';

/**
 * Thrown by fetchVideoStats ONLY for a hard auth/scope failure (401/403 or a
 * `scope_not_authorized` body) — i.e. the token is revoked/expired or was never
 * granted the `video.list` scope. This is distinct from the "missing video =
 * absent from the Map, never throw" contract: an individual deleted/private
 * video is silently absent, but a token that can't talk to the API at all is a
 * re-consent condition the sync must act on (set PlatformAccount.needsReauth).
 */
export class TikTokAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TikTokAuthError';
  }
}

@Injectable()
export class TikTokStrategy implements IPlatformStrategy {
  readonly platform = 'tiktok';
  private readonly logger = new Logger(TikTokStrategy.name);
  private readonly AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize';
  private readonly TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
  private readonly REFRESH_URL =
    'https://open.tiktokapis.com/v2/oauth/token/refresh/';
  private readonly USER_URL = 'https://open.tiktokapis.com/v2/user/info/';
  private readonly VIDEO_URL = 'https://open.tiktokapis.com/v2/video/list/';
  private readonly VIDEO_QUERY_URL =
    'https://open.tiktokapis.com/v2/video/query/';

  /** State token → PKCE code_verifier (used once, then deleted) */
  private readonly pendingVerifiers = new Map<string, string>();

  getAuthUrl(state: string, callbackUrl: string): string {
    // Generate PKCE code_verifier (64-char random hex)
    const codeVerifier = randomBytes(32).toString('hex'); // 64 hex chars
    // code_challenge = base64url(SHA256(code_verifier))
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Store verifier keyed by state for retrieval in exchangeCode
    this.pendingVerifiers.set(state, codeVerifier);

    const params = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      // video.list is required to read per-video performance stats via
      // /v2/video/query/ (the tracking sync). Accounts connected before this
      // scope was added lack it; the sync detects that (scope_not_authorized ->
      // TikTokAuthError) and flags PlatformAccount.needsReauth for re-consent.
      scope: 'user.info.basic,user.info.profile,user.info.stats,video.list',
      response_type: 'code',
      redirect_uri: callbackUrl,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${this.AUTH_URL}?${params}`;
  }

  async exchangeCode(
    code: string,
    callbackUrl: string,
    state?: string,
  ): Promise<PlatformTokens> {
    // Retrieve PKCE code_verifier from state (then remove to prevent replay)
    let codeVerifier: string | undefined;
    if (state) {
      codeVerifier = this.pendingVerifiers.get(state);
      this.pendingVerifiers.delete(state);
    }

    const body = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl,
    });

    if (codeVerifier) {
      body.set('code_verifier', codeVerifier);
    }

    const res = await fetch(this.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TikTok token exchange failed: ${text}`);
    }

    const json = await res.json();
    const data = json.data ?? json;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiry: new Date(Date.now() + (data.expires_in ?? 86400) * 1000),
      platformUserId: data.open_id,
    };
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiry: Date }> {
    const res = await fetch(this.REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) throw new Error(`TikTok token refresh HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data ?? json;

    return {
      accessToken: data.access_token,
      expiry: new Date(Date.now() + (data.expires_in ?? 86400) * 1000),
    };
  }

  async fetchChannelData(
    accessToken: string,
    platformUserId?: string,
  ): Promise<PlatformChannelData | null> {
    const fields = [
      'open_id',
      'union_id',
      'avatar_url',
      'display_name',
      'follower_count',
      'following_count',
      'likes_count',
      'video_count',
    ].join(',');

    const res = await fetch(`${this.USER_URL}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      this.logger.warn(`TikTok user info ${res.status}`);
      return null;
    }

    const json = await res.json();
    const user = json.data?.user;
    if (!user) return null;

    const followers = user.follower_count ?? 0;
    const handle = user.open_id ?? 'unknown';

    // TikTok basic API does not expose engagement rate or avg views — set to 0
    // TODO: upgrade to TikTok Research API for richer analytics
    return {
      platformUserId: user.open_id,
      handle,
      displayName: user.display_name ?? handle,
      avatarUrl: user.avatar_url ?? null,
      profileUrl: `https://www.tiktok.com/@${handle}`,
      followers,
      avgViews: 0,
      engagementRate: 0,
      country: null,
      bio: null,
      spotlightVideo: null,
    };
  }

  /**
   * Public per-video stats for a batch of the AUTHENTICATED user's video ids,
   * keyed by videoId. Mirrors YouTubeStrategy.fetchVideoStats but is inherently
   * per-token: the Display API /v2/video/query/ only returns videos owned by the
   * user whose `accessToken` is supplied. Used by the tracking sync.
   *
   * - Chunks ids into batches of 20 (video.query max), one call per chunk.
   * - A video that returns no item (deleted/private/not-owned) is simply absent
   *   from the Map — never throws for that.
   * - Unlike YouTube, TikTok DOES expose share_count, so `shares` is real.
   * - Throws {@link TikTokAuthError} on a hard auth/scope failure (401/403 or a
   *   scope_not_authorized body) so the caller can flag the account for re-auth.
   */
  async fetchVideoStats(
    accessToken: string,
    videoIds: string[],
  ): Promise<
    Map<
      string,
      { views: number; likes: number; comments: number; shares: number }
    >
  > {
    const out = new Map<
      string,
      { views: number; likes: number; comments: number; shares: number }
    >();
    if (!videoIds.length) return out;

    const fields = 'id,view_count,like_count,comment_count,share_count';

    for (let i = 0; i < videoIds.length; i += 20) {
      const chunk = videoIds.slice(i, i + 20);
      const res = await fetch(`${this.VIDEO_QUERY_URL}?fields=${fields}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filters: { video_ids: chunk } }),
      });

      // Hard auth/scope failure — the token is revoked/expired or never granted
      // video.list. Surface it so the sync can flag re-consent.
      if (res.status === 401 || res.status === 403) {
        throw new TikTokAuthError(`TikTok video.query HTTP ${res.status}`);
      }

      if (!res.ok) {
        // Transient/other error for this chunk — mirror YouTube: log and skip.
        this.logger.warn(
          `TikTok video.query ${res.status} for ${chunk.length} ids`,
        );
        continue;
      }

      const json = await res.json();
      const code: string | undefined = json.error?.code;
      if (code && code !== 'ok') {
        if (
          code === 'scope_not_authorized' ||
          code === 'access_token_invalid'
        ) {
          throw new TikTokAuthError(`TikTok video.query error: ${code}`);
        }
        this.logger.warn(`TikTok video.query error: ${code}`);
        continue;
      }

      const items: any[] = json.data?.videos ?? [];
      for (const v of items) {
        out.set(String(v.id), {
          views: v.view_count ?? 0,
          likes: v.like_count ?? 0,
          comments: v.comment_count ?? 0,
          shares: v.share_count ?? 0,
        });
      }
    }

    return out;
  }

  // TODO: TikTok basic Login Kit does not expose audience demographics.
  // Upgrade to TikTok Research API for gender/age data.
  fetchAnalyticsData = undefined;
}
