import { Injectable, Logger } from '@nestjs/common';
import type {
  IPlatformStrategy,
  PlatformTokens,
  PlatformChannelData,
  PlatformAnalyticsData,
} from './platform-strategy.interface';

@Injectable()
export class TikTokStrategy implements IPlatformStrategy {
  readonly platform = 'tiktok';
  private readonly logger = new Logger(TikTokStrategy.name);
  private readonly AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
  private readonly TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
  private readonly USER_URL = 'https://open.tiktokapis.com/v2/user/info/';
  private readonly VIDEO_URL = 'https://open.tiktokapis.com/v2/video/list/';

  getAuthUrl(state: string, callbackUrl: string): string {
    const params = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      scope: 'user.info.basic,user.info.stats,video.list',
      response_type: 'code',
      redirect_uri: callbackUrl,
      state,
    });
    return `${this.AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string, callbackUrl: string): Promise<PlatformTokens> {
    const res = await fetch(this.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
      }),
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

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiry: Date }> {
    const res = await fetch(this.TOKEN_URL, {
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

  async fetchChannelData(accessToken: string, platformUserId?: string): Promise<PlatformChannelData | null> {
    const fields = [
      'open_id', 'avatar_url', 'display_name',
      'bio_description', 'profile_deep_link',
      'follower_count', 'following_count', 'likes_count', 'video_count',
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
    const profileDeepLink: string = user.profile_deep_link ?? '';
    const handleMatch = profileDeepLink.match(/@([^/?]+)/);
    const handle = handleMatch ? handleMatch[1] : (user.open_id ?? 'unknown');

    const { avgViews, engagementRate, spotlightVideo } = await this.fetchVideoStats(
      accessToken,
      followers,
    );

    return {
      platformUserId: user.open_id,
      handle,
      displayName: user.display_name ?? handle,
      avatarUrl: user.avatar_url ?? null,
      profileUrl: profileDeepLink || `https://www.tiktok.com/@${handle}`,
      followers,
      avgViews,
      engagementRate,
      country: null,
      bio: user.bio_description ?? null,
      spotlightVideo,
    };
  }

  private async fetchVideoStats(
    accessToken: string,
    followers: number,
  ): Promise<{ avgViews: number; engagementRate: number; spotlightVideo: PlatformChannelData['spotlightVideo'] }> {
    const empty = { avgViews: 0, engagementRate: 0, spotlightVideo: null };

    const fields = 'id,title,cover_image_url,play_count,like_count,comment_count,share_count';
    const res = await fetch(`${this.VIDEO_URL}?fields=${fields}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ max_count: 20 }),
    });

    if (!res.ok) return empty;
    const json = await res.json();
    const videos: any[] = json.data?.videos ?? [];
    if (!videos.length) return empty;

    const totals = videos.reduce(
      (acc, v) => ({
        plays: acc.plays + (v.play_count ?? 0),
        likes: acc.likes + (v.like_count ?? 0),
        comments: acc.comments + (v.comment_count ?? 0),
        shares: acc.shares + (v.share_count ?? 0),
        count: acc.count + 1,
      }),
      { plays: 0, likes: 0, comments: 0, shares: 0, count: 0 },
    );

    const avgViews = totals.count > 0 ? Math.round(totals.plays / totals.count) : 0;
    const engagementRate =
      followers > 0
        ? parseFloat(
            (((totals.likes + totals.comments + totals.shares) / totals.count / followers) * 100).toFixed(2),
          )
        : 0;

    const top = [...videos].sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))[0];
    const spotlightVideo = top
      ? { id: top.id, title: top.title ?? 'Top Video', thumbnail: top.cover_image_url ?? '' }
      : null;

    return { avgViews, engagementRate, spotlightVideo };
  }

  // TikTok does not expose audience demographics without Research API
  fetchAnalyticsData = undefined;
}
