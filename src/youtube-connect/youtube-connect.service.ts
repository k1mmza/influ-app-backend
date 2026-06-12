import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiry: Date;
}

interface ChannelData {
  channelId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  profileUrl: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  avgViews: number;
  engagementRate: number;
  country: string | null;
  bio: string | null;
  uploadsPlaylistId: string;
  topVideoIds: string[];
  videoTitles: string[];
  spotlightVideo: { id: string; title: string; thumbnail: string } | null;
}

interface AnalyticsData {
  watchTimeMins: number;
  avgViewDuration: number;
  avgViewPct: number;
  subscribersGained: number;
  topCountries: { country: string; viewPct: number }[];
  malePct: number | null;
  femalePct: number | null;
  ageDistribution: Record<string, number> | null;
}

@Injectable()
export class YouTubeConnectService {
  private readonly logger = new Logger(YouTubeConnectService.name);
  private readonly YT_BASE = 'https://www.googleapis.com/youtube/v3';
  private readonly YTA_BASE = 'https://youtubeanalytics.googleapis.com/v2';
  private readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private readonly AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // ── 1. Generate OAuth URL ─────────────────────────────────────────────────

  getAuthUrl(userId: string): string {
    const state = this.jwtService.sign(
      { userId, purpose: 'youtube-connect' },
      { expiresIn: '10m' },
    );

    const callbackUrl =
      process.env.YOUTUBE_CONNECT_CALLBACK_URL ||
      'http://localhost:3001/auth/youtube/connect/callback';

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `${this.AUTH_URL}?${params}`;
  }

  // ── 2. Handle OAuth callback ──────────────────────────────────────────────

  async handleCallback(code: string, stateToken: string): Promise<string> {
    // Verify signed state
    let payload: { userId: string; purpose: string };
    try {
      payload = this.jwtService.verify(stateToken) as any;
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
    if (payload.purpose !== 'youtube-connect') {
      throw new UnauthorizedException('Wrong OAuth purpose');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      include: { influencerProfile: true },
    });
    if (!user) throw new UnauthorizedException();
    if (user.role !== 'INFLUENCER') throw new ForbiddenException('Only influencers can connect a YouTube account');
    if (!user.influencerProfile) throw new BadRequestException('Complete your profile before linking YouTube');

    // Exchange code → tokens
    const tokens = await this.exchangeCode(code);

    // Fetch channel data + analytics in parallel
    const [channelData, analyticsData] = await Promise.all([
      this.fetchChannelData(tokens.accessToken),
      this.fetchAnalyticsData(tokens.accessToken).catch((e) => {
        this.logger.warn(`Analytics fetch failed: ${e.message} — continuing without analytics`);
        return null;
      }),
    ]);

    if (!channelData) throw new InternalServerErrorException('Could not retrieve YouTube channel data');

    await this.persistAccount(user.influencerProfile.id, tokens, channelData, analyticsData);

    return payload.userId;
  }

  // ── 3. Sync an existing linked account (called by SyncProcessor) ──────────

  async syncLinkedAccount(platformAccountId: string): Promise<void> {
    const account = await this.prisma.platformAccount.findUnique({
      where: { id: platformAccountId },
    });
    if (!account?.refreshToken) return;

    let accessToken = account.accessToken!;

    // Refresh if expired or expires within 5 minutes
    const fiveMin = new Date(Date.now() + 5 * 60 * 1000);
    if (!account.tokenExpiry || account.tokenExpiry < fiveMin) {
      try {
        const refreshed = await this.refreshToken(account.refreshToken);
        accessToken = refreshed.accessToken;
        await this.prisma.platformAccount.update({
          where: { id: platformAccountId },
          data: { accessToken: refreshed.accessToken, tokenExpiry: refreshed.expiry },
        });
      } catch (e: any) {
        this.logger.error(`Token refresh failed for account ${platformAccountId}: ${e.message}`);
        return;
      }
    }

    const [channelData, analyticsData] = await Promise.all([
      this.fetchChannelData(accessToken),
      this.fetchAnalyticsData(accessToken).catch(() => null),
    ]);

    if (!channelData) return;

    const influencerProfile = await this.prisma.influencerProfile.findFirst({
      where: { platformAccounts: { some: { id: platformAccountId } } },
    });
    if (!influencerProfile) return;

    const dummyTokens: OAuthTokens = {
      accessToken,
      refreshToken: account.refreshToken,
      expiry: account.tokenExpiry ?? new Date(Date.now() + 3600 * 1000),
    };

    await this.persistAccount(influencerProfile.id, dummyTokens, channelData, analyticsData, platformAccountId);
    this.logger.log(`OAuth sync complete for account ${platformAccountId}`);
  }

  // ── Private: persist account + audience insight ───────────────────────────

  private async persistAccount(
    influencerId: string,
    tokens: OAuthTokens,
    channel: ChannelData,
    analytics: AnalyticsData | null,
    existingAccountId?: string,
  ) {
    const data: any = {
      platform: 'youtube',
      handle: channel.handle,
      displayName: channel.displayName,
      avatarUrl: channel.avatarUrl,
      profileUrl: channel.profileUrl,
      followers: channel.subscribers,
      avgViews: channel.avgViews,
      engagementRate: channel.engagementRate,
      channelId: channel.channelId,
      accessToken: tokens.accessToken,
      tokenExpiry: tokens.expiry,
      syncedAt: new Date(),
      spotlightVideoId: channel.spotlightVideo?.id ?? null,
      spotlightVideoTitle: channel.spotlightVideo?.title ?? null,
      spotlightThumbnailUrl: channel.spotlightVideo?.thumbnail ?? null,
      ...(analytics && {
        watchTimeMins: analytics.watchTimeMins,
        avgViewDuration: analytics.avgViewDuration,
        avgViewPct: analytics.avgViewPct,
        subscribersGained: analytics.subscribersGained,
        topCountries: analytics.topCountries,
      }),
    };

    // Only overwrite refresh token if a new one was issued
    if (tokens.refreshToken) data.refreshToken = tokens.refreshToken;

    let account: any;
    if (existingAccountId) {
      account = await this.prisma.platformAccount.update({ where: { id: existingAccountId }, data });
    } else {
      // Try to find existing youtube account for this influencer
      const existing = await this.prisma.platformAccount.findFirst({
        where: { influencerId, platform: 'youtube' },
      });
      if (existing) {
        account = await this.prisma.platformAccount.update({ where: { id: existing.id }, data });
      } else {
        account = await this.prisma.platformAccount.create({ data: { influencerId, ...data } });
      }
    }

    // Persist audience insight (demographics)
    if (analytics) {
      const insightData = {
        malePct: analytics.malePct,
        femalePct: analytics.femalePct,
        ageDistribution: analytics.ageDistribution as any,
      };
      const insight = await this.prisma.audienceInsight.findFirst({
        where: { platformAccountId: account.id },
      });
      if (insight) {
        await this.prisma.audienceInsight.update({ where: { id: insight.id }, data: insightData });
      } else {
        await this.prisma.audienceInsight.create({ data: { platformAccountId: account.id, ...insightData } });
      }
    }

    // Update influencer profile country if available
    if (channel.country) {
      await this.prisma.influencerProfile.update({
        where: { id: influencerId },
        data: { country: channel.country, bio: channel.bio ?? undefined },
      });
    }

    return account;
  }

  // ── Private: exchange code for tokens ────────────────────────────────────

  private async exchangeCode(code: string): Promise<OAuthTokens> {
    const callbackUrl =
      process.env.YOUTUBE_CONNECT_CALLBACK_URL ||
      'http://localhost:3001/auth/youtube/connect/callback';

    const res = await fetch(this.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new InternalServerErrorException(`Token exchange failed: ${err}`);
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiry: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    };
  }

  // ── Private: refresh expired access token ────────────────────────────────

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; expiry: Date }> {
    const res = await fetch(this.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) throw new Error(`Token refresh HTTP ${res.status}`);
    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiry: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    };
  }

  // ── Private: fetch YouTube Data API channel info ──────────────────────────

  async fetchChannelData(accessToken: string): Promise<ChannelData | null> {
    const parts = 'snippet,statistics,contentDetails';
    const res = await fetch(
      `${this.YT_BASE}/channels?part=${parts}&mine=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      this.logger.warn(`YouTube channels API ${res.status}`);
      return null;
    }
    const json = await res.json();
    const ch = json.items?.[0];
    if (!ch) return null;

    const subscribers = parseInt(ch.statistics?.subscriberCount ?? '0', 10);
    const videoCount = parseInt(ch.statistics?.videoCount ?? '0', 10);
    const totalViews = parseInt(ch.statistics?.viewCount ?? '0', 10);
    const uploadsId = ch.contentDetails?.relatedPlaylists?.uploads ?? '';
    const handle = ch.snippet?.customUrl?.replace(/^@/, '') ?? ch.id;
    const countryCode = ch.snippet?.country;
    const country = countryCode
      ? new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? null
      : null;

    let avgViews = videoCount > 0 ? Math.round(totalViews / videoCount) : 0;
    let engagementRate = 0;
    let spotlightVideo: ChannelData['spotlightVideo'] = null;
    let topVideoIds: string[] = [];
    let videoTitles: string[] = [];

    if (uploadsId) {
      const vs = await this.fetchRecentVideoStats(uploadsId, accessToken);
      if (vs.avgViews > 0) avgViews = vs.avgViews;
      engagementRate = vs.engagementRate;
      spotlightVideo = vs.spotlightVideo;
      topVideoIds = vs.topVideoIds;
      videoTitles = vs.videoTitles;
    }

    return {
      channelId: ch.id,
      handle,
      displayName: ch.snippet?.title ?? handle,
      avatarUrl:
        ch.snippet?.thumbnails?.high?.url ??
        ch.snippet?.thumbnails?.default?.url ??
        null,
      profileUrl: `https://www.youtube.com/@${handle}`,
      subscribers,
      totalViews,
      videoCount,
      avgViews,
      engagementRate,
      country,
      bio: ch.snippet?.description ?? null,
      uploadsPlaylistId: uploadsId,
      topVideoIds,
      videoTitles,
      spotlightVideo,
    };
  }

  private async fetchRecentVideoStats(
    uploadsId: string,
    accessToken: string,
  ): Promise<{ avgViews: number; engagementRate: number; spotlightVideo: ChannelData['spotlightVideo']; topVideoIds: string[]; videoTitles: string[] }> {
    const empty = { avgViews: 0, engagementRate: 0, spotlightVideo: null, topVideoIds: [], videoTitles: [] };

    const playlistRes = await fetch(
      `${this.YT_BASE}/playlistItems?part=contentDetails&playlistId=${uploadsId}&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!playlistRes.ok) return empty;
    const playlist = await playlistRes.json();
    const ids = (playlist.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean).join(',');
    if (!ids) return empty;

    const videosRes = await fetch(
      `${this.YT_BASE}/videos?part=statistics,snippet&id=${encodeURIComponent(ids)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!videosRes.ok) return empty;
    const videos = await videosRes.json();
    if (!videos.items?.length) return empty;

    const totals = videos.items.reduce(
      (acc: any, v: any) => ({
        views: acc.views + parseInt(v.statistics?.viewCount ?? '0', 10),
        likes: acc.likes + parseInt(v.statistics?.likeCount ?? '0', 10),
        comments: acc.comments + parseInt(v.statistics?.commentCount ?? '0', 10),
        count: acc.count + 1,
      }),
      { views: 0, likes: 0, comments: 0, count: 0 },
    );

    const avgViews = totals.count > 0 ? Math.round(totals.views / totals.count) : 0;
    const engagementRate =
      totals.views > 0
        ? parseFloat((((totals.likes + totals.comments) / totals.views) * 100).toFixed(2))
        : 0;

    const sorted = [...videos.items].sort(
      (a: any, b: any) =>
        parseInt(b.statistics?.viewCount ?? '0', 10) - parseInt(a.statistics?.viewCount ?? '0', 10),
    );
    const top = sorted[0];
    const spotlightVideo = top
      ? {
          id: top.id as string,
          title: (top.snippet?.title ?? 'Top Video') as string,
          thumbnail:
            top.snippet?.thumbnails?.maxres?.url ??
            top.snippet?.thumbnails?.high?.url ??
            `https://img.youtube.com/vi/${top.id}/mqdefault.jpg`,
        }
      : null;

    return {
      avgViews,
      engagementRate,
      spotlightVideo,
      topVideoIds: sorted.map((v: any) => v.id).filter(Boolean).slice(0, 10),
      videoTitles: sorted.map((v: any) => v.snippet?.title).filter(Boolean).slice(0, 10),
    };
  }

  // ── Private: fetch YouTube Analytics API data ────────────────────────────

  async fetchAnalyticsData(accessToken: string): Promise<AnalyticsData> {
    const today = new Date();
    const ninetyAgo = new Date(today);
    ninetyAgo.setDate(today.getDate() - 90);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const [mainRes, demoRes, geoRes] = await Promise.all([
      fetch(
        `${this.YTA_BASE}/reports?ids=channel%3D%3DMINE&startDate=${fmt(ninetyAgo)}&endDate=${fmt(today)}&metrics=estimatedMinutesWatched,subscribersGained,subscribersLost,averageViewDuration,averageViewPercentage`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
      fetch(
        `${this.YTA_BASE}/reports?ids=channel%3D%3DMINE&startDate=${fmt(ninetyAgo)}&endDate=${fmt(today)}&dimensions=ageGroup,gender&metrics=viewerPercentage`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
      fetch(
        `${this.YTA_BASE}/reports?ids=channel%3D%3DMINE&startDate=${fmt(ninetyAgo)}&endDate=${fmt(today)}&dimensions=country&metrics=views&sort=-views&maxResults=5`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    ]);

    // Main totals
    let watchTimeMins = 0, avgViewDuration = 0, avgViewPct = 0, subscribersGained = 0;
    if (mainRes.ok) {
      const main = await mainRes.json();
      const row = main.rows?.[0] ?? [];
      const cols: string[] = (main.columnHeaders ?? []).map((h: any) => h.name);
      const idx = (name: string) => cols.indexOf(name);
      watchTimeMins = row[idx('estimatedMinutesWatched')] ?? 0;
      subscribersGained = row[idx('subscribersGained')] ?? 0;
      avgViewDuration = row[idx('averageViewDuration')] ?? 0;
      avgViewPct = row[idx('averageViewPercentage')] ?? 0;
    }

    // Demographics
    let malePct: number | null = null;
    let femalePct: number | null = null;
    let ageDistribution: Record<string, number> | null = null;

    if (demoRes.ok) {
      const demo = await demoRes.json();
      if (demo.rows?.length) {
        const cols: string[] = (demo.columnHeaders ?? []).map((h: any) => h.name);
        const genderIdx = cols.indexOf('gender');
        const ageIdx = cols.indexOf('ageGroup');
        const pctIdx = cols.indexOf('viewerPercentage');

        const ageBuckets: Record<string, number> = {};
        let maleSum = 0, femaleSum = 0;

        for (const row of demo.rows) {
          const gender = row[genderIdx]?.toLowerCase();
          const age = row[ageIdx];
          const pct = row[pctIdx] ?? 0;
          if (gender === 'male') maleSum += pct;
          if (gender === 'female') femaleSum += pct;
          if (age) ageBuckets[age] = (ageBuckets[age] ?? 0) + pct;
        }

        malePct = parseFloat(maleSum.toFixed(1));
        femalePct = parseFloat(femaleSum.toFixed(1));
        ageDistribution = ageBuckets;
      }
    }

    // Top countries
    const topCountries: { country: string; viewPct: number }[] = [];
    if (geoRes.ok) {
      const geo = await geoRes.json();
      const rows: any[] = geo.rows ?? [];
      const cols: string[] = (geo.columnHeaders ?? []).map((h: any) => h.name);
      const countryIdx = cols.indexOf('country');
      const viewsIdx = cols.indexOf('views');

      const total = rows.reduce((sum, r) => sum + (r[viewsIdx] ?? 0), 0);
      for (const row of rows) {
        const cc = row[countryIdx];
        const views = row[viewsIdx] ?? 0;
        const name = cc
          ? new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) ?? cc
          : cc;
        topCountries.push({
          country: name,
          viewPct: total > 0 ? parseFloat(((views / total) * 100).toFixed(1)) : 0,
        });
      }
    }

    return { watchTimeMins, avgViewDuration, avgViewPct, subscribersGained, topCountries, malePct, femalePct, ageDistribution };
  }
}
