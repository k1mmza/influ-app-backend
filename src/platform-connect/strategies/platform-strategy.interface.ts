export interface PlatformTokens {
  accessToken: string;
  refreshToken: string | null;
  expiry: Date;
  platformUserId?: string;
}

export interface PlatformChannelData {
  platformUserId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  profileUrl: string;
  followers: number;
  avgViews: number;
  engagementRate: number;
  country: string | null;
  bio: string | null;
  spotlightVideo: { id: string; title: string; thumbnail: string } | null;
}

export interface PlatformAnalyticsData {
  watchTimeMins?: number;
  avgViewDuration?: number;
  avgViewPct?: number;
  subscribersGained?: number;
  topCountries?: { country: string; viewPct: number }[];
  malePct?: number | null;
  femalePct?: number | null;
  ageDistribution?: Record<string, number> | null;
}

export interface IPlatformStrategy {
  readonly platform: string;
  getAuthUrl(state: string, callbackUrl: string): string;
  exchangeCode(code: string, callbackUrl: string): Promise<PlatformTokens>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiry: Date }>;
  fetchChannelData(accessToken: string, platformUserId?: string): Promise<PlatformChannelData | null>;
  fetchAnalyticsData?(accessToken: string, platformUserId?: string): Promise<PlatformAnalyticsData | null>;
}
