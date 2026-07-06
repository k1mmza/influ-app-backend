import { Injectable, Logger } from '@nestjs/common';
import type {
  IPlatformStrategy,
  PlatformTokens,
  PlatformChannelData,
  PlatformAnalyticsData,
} from './platform-strategy.interface';

@Injectable()
export class YouTubeStrategy implements IPlatformStrategy {
  readonly platform = 'youtube';
  private readonly logger = new Logger(YouTubeStrategy.name);
  private readonly YT_BASE = 'https://www.googleapis.com/youtube/v3';
  private readonly YTA_BASE = 'https://youtubeanalytics.googleapis.com/v2';
  private readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private readonly AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

  getAuthUrl(state: string, callbackUrl: string): string {
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

  async exchangeCode(
    code: string,
    callbackUrl: string,
  ): Promise<PlatformTokens> {
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
      throw new Error(`YouTube token exchange failed: ${err}`);
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiry: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    };
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiry: Date }> {
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

    if (!res.ok) throw new Error(`YouTube token refresh HTTP ${res.status}`);
    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiry: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    };
  }

  async fetchChannelData(
    accessToken: string,
  ): Promise<PlatformChannelData | null> {
    const res = await fetch(
      `${this.YT_BASE}/channels?part=snippet,statistics,contentDetails&mine=true`,
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
      ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ??
        null)
      : null;

    let avgViews = videoCount > 0 ? Math.round(totalViews / videoCount) : 0;
    let engagementRate = 0;
    let spotlightVideo: PlatformChannelData['spotlightVideo'] = null;

    if (uploadsId) {
      const vs = await this.fetchRecentVideoStats(uploadsId, accessToken);
      if (vs.avgViews > 0) avgViews = vs.avgViews;
      engagementRate = vs.engagementRate;
      spotlightVideo = vs.spotlightVideo;
    }

    return {
      platformUserId: ch.id,
      handle,
      displayName: ch.snippet?.title ?? handle,
      avatarUrl:
        ch.snippet?.thumbnails?.high?.url ??
        ch.snippet?.thumbnails?.default?.url ??
        null,
      profileUrl: `https://www.youtube.com/@${handle}`,
      followers: subscribers,
      avgViews,
      engagementRate,
      country,
      bio: ch.snippet?.description ?? null,
      spotlightVideo,
    };
  }

  private async fetchRecentVideoStats(uploadsId: string, accessToken: string) {
    const empty = {
      avgViews: 0,
      engagementRate: 0,
      spotlightVideo: null as PlatformChannelData['spotlightVideo'],
    };

    const playlistRes = await fetch(
      `${this.YT_BASE}/playlistItems?part=contentDetails&playlistId=${uploadsId}&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!playlistRes.ok) return empty;

    const playlist = await playlistRes.json();
    const ids = (playlist.items ?? [])
      .map((i: any) => i.contentDetails?.videoId)
      .filter(Boolean)
      .join(',');
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
        comments:
          acc.comments + parseInt(v.statistics?.commentCount ?? '0', 10),
        count: acc.count + 1,
      }),
      { views: 0, likes: 0, comments: 0, count: 0 },
    );

    const avgViews =
      totals.count > 0 ? Math.round(totals.views / totals.count) : 0;
    const engagementRate =
      totals.views > 0
        ? parseFloat(
            (((totals.likes + totals.comments) / totals.views) * 100).toFixed(
              2,
            ),
          )
        : 0;

    const sorted = [...videos.items].sort(
      (a: any, b: any) =>
        parseInt(b.statistics?.viewCount ?? '0', 10) -
        parseInt(a.statistics?.viewCount ?? '0', 10),
    );
    const top = sorted[0];
    const spotlightVideo: PlatformChannelData['spotlightVideo'] = top
      ? {
          id: top.id,
          title: top.snippet?.title ?? 'Top Video',
          thumbnail:
            top.snippet?.thumbnails?.maxres?.url ??
            top.snippet?.thumbnails?.high?.url ??
            `https://img.youtube.com/vi/${top.id}/mqdefault.jpg`,
        }
      : null;

    return { avgViews, engagementRate, spotlightVideo };
  }

  /**
   * Public per-video stats for a batch of video IDs, keyed by videoId. Used by
   * the tracking sync over arbitrary published videos, so it authenticates with
   * the app-level YOUTUBE_API_KEY (no per-user OAuth context) rather than a
   * Bearer token — same videos.list request shape as fetchRecentVideoStats.
   *
   * - Chunks IDs into batches of 50 (videos.list max), one call per chunk.
   * - A video that returns no item (deleted/private) is simply absent from the
   *   Map — never throws.
   * - `shares` is not exposed by this API, so only views/likes/comments are
   *   returned; a hidden like/comment count defaults to 0.
   * - Also returns static per-content metadata from the snippet we ALREADY
   *   request (part=snippet): a card-sized thumbnail URL and the true publish
   *   date. Both are null when absent. No extra API cost.
   */
  async fetchVideoStats(
    videoIds: string[],
  ): Promise<
    Map<
      string,
      {
        views: number;
        likes: number;
        comments: number;
        thumbnailUrl: string | null;
        publishedAt: string | null;
      }
    >
  > {
    const out = new Map<
      string,
      {
        views: number;
        likes: number;
        comments: number;
        thumbnailUrl: string | null;
        publishedAt: string | null;
      }
    >();
    if (!videoIds.length) return out;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      this.logger.warn('YOUTUBE_API_KEY not set — skipping video stats fetch');
      return out;
    }

    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const ids = chunk.join(',');
      const res = await fetch(
        `${this.YT_BASE}/videos?part=statistics,snippet&id=${encodeURIComponent(ids)}&key=${apiKey}`,
      );
      if (!res.ok) {
        this.logger.warn(
          `YouTube videos API ${res.status} for ${chunk.length} ids`,
        );
        continue;
      }

      const json = await res.json();
      const items: any[] = json.items ?? [];
      for (const v of items) {
        const thumbs = v.snippet?.thumbnails ?? {};
        out.set(v.id, {
          views: parseInt(v.statistics?.viewCount ?? '0', 10),
          likes: parseInt(v.statistics?.likeCount ?? '0', 10),
          comments: parseInt(v.statistics?.commentCount ?? '0', 10),
          // Highest available still image. maxres/standard are not guaranteed on
          // every video, so fall back down to `default` (always present). These
          // are stable i.ytimg.com URLs — safe to persist once.
          thumbnailUrl:
            thumbs.maxres?.url ??
            thumbs.standard?.url ??
            thumbs.high?.url ??
            thumbs.medium?.url ??
            thumbs.default?.url ??
            null,
          // True on-platform publish date (ISO 8601 string).
          publishedAt: v.snippet?.publishedAt ?? null,
        });
      }
      if (items.length < chunk.length) {
        this.logger.debug(
          `YouTube videos: ${chunk.length - items.length} of ${chunk.length} ids returned no item`,
        );
      }
    }

    return out;
  }

  async fetchAnalyticsData(
    accessToken: string,
  ): Promise<PlatformAnalyticsData> {
    const today = new Date();
    const ninetyAgo = new Date(today);
    ninetyAgo.setDate(today.getDate() - 90);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const [mainRes, demoRes, geoRes] = await Promise.all([
      fetch(
        `${this.YTA_BASE}/reports?ids=channel%3D%3DMINE&startDate=${fmt(ninetyAgo)}&endDate=${fmt(today)}&metrics=estimatedMinutesWatched,subscribersGained,averageViewDuration,averageViewPercentage`,
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

    let watchTimeMins = 0,
      avgViewDuration = 0,
      avgViewPct = 0,
      subscribersGained = 0;
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

    let malePct: number | null = null;
    let femalePct: number | null = null;
    let ageDistribution: Record<string, number> | null = null;

    if (demoRes.ok) {
      const demo = await demoRes.json();
      if (demo.rows?.length) {
        const cols: string[] = (demo.columnHeaders ?? []).map(
          (h: any) => h.name,
        );
        const genderIdx = cols.indexOf('gender');
        const ageIdx = cols.indexOf('ageGroup');
        const pctIdx = cols.indexOf('viewerPercentage');
        const ageBuckets: Record<string, number> = {};
        let maleSum = 0,
          femaleSum = 0;

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
          ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) ?? cc)
          : cc;
        topCountries.push({
          country: name,
          viewPct:
            total > 0 ? parseFloat(((views / total) * 100).toFixed(1)) : 0,
        });
      }
    }

    return {
      watchTimeMins,
      avgViewDuration,
      avgViewPct,
      subscribersGained,
      topCountries,
      malePct,
      femalePct,
      ageDistribution,
    };
  }
}
