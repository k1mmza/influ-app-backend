import { Injectable, Logger } from '@nestjs/common';
import type {
  IPlatformStrategy,
  PlatformTokens,
  PlatformChannelData,
  PlatformAnalyticsData,
} from './platform-strategy.interface';

@Injectable()
export class InstagramStrategy implements IPlatformStrategy {
  readonly platform = 'instagram';
  private readonly logger = new Logger(InstagramStrategy.name);
  private readonly AUTH_URL = 'https://api.instagram.com/oauth/authorize';
  private readonly TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
  private readonly LONG_LIVED_URL = 'https://graph.instagram.com/access_token';
  private readonly REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
  private readonly GRAPH_URL = 'https://graph.instagram.com';

  getAuthUrl(state: string, callbackUrl: string): string {
    const params = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      redirect_uri: callbackUrl,
      scope: 'user_profile,user_media',
      response_type: 'code',
      state,
    });
    return `${this.AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string, callbackUrl: string, state?: string): Promise<PlatformTokens> {
    // Step 1: Exchange code for short-lived token
    const shortLivedBody = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl,
      code,
    });

    const shortRes = await fetch(this.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: shortLivedBody,
    });

    if (!shortRes.ok) {
      const text = await shortRes.text();
      throw new Error(`Instagram short-lived token exchange failed: ${text}`);
    }

    const shortData = await shortRes.json();
    const shortAccessToken: string = shortData.access_token;
    const platformUserId: string = String(shortData.user_id);

    // Step 2: Exchange short-lived token for long-lived token (60-day expiry)
    const longLivedParams = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      access_token: shortAccessToken,
    });

    const longRes = await fetch(`${this.LONG_LIVED_URL}?${longLivedParams}`);

    if (!longRes.ok) {
      const text = await longRes.text();
      this.logger.warn(`Instagram long-lived token exchange failed: ${text}. Falling back to short-lived token.`);
      // Fall back to short-lived token (1 hour)
      return {
        accessToken: shortAccessToken,
        refreshToken: shortAccessToken, // Instagram uses the long-lived token itself as refresh
        expiry: new Date(Date.now() + 3600 * 1000),
        platformUserId,
      };
    }

    const longData = await longRes.json();
    const longAccessToken: string = longData.access_token;
    // Instagram long-lived tokens expire in 60 days
    const expiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    return {
      accessToken: longAccessToken,
      // Instagram long-lived tokens can be refreshed using themselves
      refreshToken: longAccessToken,
      expiry,
      platformUserId,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiry: Date }> {
    // Instagram long-lived tokens are refreshed by calling the refresh endpoint with the token itself
    const params = new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: refreshToken,
    });

    const res = await fetch(`${this.REFRESH_URL}?${params}`);

    if (!res.ok) throw new Error(`Instagram token refresh HTTP ${res.status}`);
    const data = await res.json();

    return {
      accessToken: data.access_token,
      expiry: new Date(Date.now() + (data.expires_in ?? 60 * 24 * 60 * 60) * 1000),
    };
  }

  async fetchChannelData(accessToken: string, platformUserId?: string): Promise<PlatformChannelData | null> {
    const params = new URLSearchParams({
      fields: 'id,username,account_type,media_count',
      access_token: accessToken,
    });

    const res = await fetch(`${this.GRAPH_URL}/me?${params}`);

    if (!res.ok) {
      this.logger.warn(`Instagram Graph API /me ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data.id) return null;

    const id = data.id;
    const username: string = data.username ?? id;

    // TODO: Instagram Basic Display API does not expose follower count.
    // Upgrade to Instagram Graph API (Business/Creator accounts) for followers, reach, and impressions.
    return {
      platformUserId: id,
      handle: username,
      displayName: username,
      avatarUrl: null,
      profileUrl: `https://www.instagram.com/${username}/`,
      followers: 0,
      avgViews: 0,
      engagementRate: 0,
      country: null,
      bio: null,
      spotlightVideo: null,
    };
  }

  // TODO: Instagram Basic Display API does not expose audience demographics.
  // Upgrade to Instagram Graph API Insights for gender/age/location data.
  fetchAnalyticsData = undefined;
}
