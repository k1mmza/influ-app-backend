import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, PlatformProfile } from './platform.adapter';

interface ApifyTikTokUser {
  uniqueId?: string;
  nickname?: string;
  signature?: string;
  avatarLarger?: string;
  followerCount?: number;
  heartCount?: number;
  videoCount?: number;
  region?: string;
}

interface ApifyTikTokVideo {
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  text?: string;
  coverUrl?: string;
  id?: string;
}

@Injectable()
export class TikTokAdapter extends PlatformAdapter {
  readonly platform = 'tiktok';
  private readonly logger = new Logger(TikTokAdapter.name);
  private readonly base = 'https://api.apify.com/v2';
  private readonly actorId = 'clockworks~tiktok-profile-scraper';

  async fetchProfile(handle: string): Promise<PlatformProfile | null> {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
      this.logger.warn('APIFY_API_TOKEN not set — skipping TikTok fetch');
      return null;
    }

    const clean = handle.replace(/^@/, '');

    try {
      const items = await this.runActor(token, {
        profiles: [`@${clean}`],
        resultsPerPage: 20,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
      });

      if (!items?.length) return null;

      // First item is the user profile, remaining items are videos
      const user = items[0] as ApifyTikTokUser;
      const videos = items.slice(1) as ApifyTikTokVideo[];

      const followers = user.followerCount ?? 0;
      const videoCount = user.videoCount ?? 0;

      // ER = (likes + comments + shares) / views × 100 from recent videos
      // Fall back to heartCount / followers / videoCount proxy if no video data
      const engagementRate = this.calcEngagementRate(videos, user.heartCount ?? 0, followers, videoCount);
      const avgViews = this.calcAvgViews(videos);

      const countryCode = user.region;
      const country = countryCode
        ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? countryCode)
        : undefined;

      return {
        handle: clean,
        displayName: user.nickname ?? clean,
        bio: user.signature ?? null,
        followers,
        avgViews,
        engagementRate,
        growthRate: 0,
        profileUrl: `https://www.tiktok.com/@${clean}`,
        country,
        avatarUrl: user.avatarLarger ?? undefined,
      };
    } catch (err: any) {
      this.logger.error(`TikTok fetch failed for "${handle}": ${err.message}`);
      return null;
    }
  }

  private calcEngagementRate(
    videos: ApifyTikTokVideo[],
    totalHearts: number,
    followers: number,
    videoCount: number,
  ): number {
    if (videos.length > 0) {
      const totals = videos.reduce(
        (acc, v) => ({
          views: acc.views + (v.playCount ?? 0),
          eng: acc.eng + (v.diggCount ?? 0) + (v.commentCount ?? 0) + (v.shareCount ?? 0),
          count: acc.count + 1,
        }),
        { views: 0, eng: 0, count: 0 },
      );
      if (totals.views > 0) {
        return parseFloat(((totals.eng / totals.views) * 100).toFixed(2));
      }
    }

    // Fallback: avg likes per video / followers
    if (followers > 0 && videoCount > 0) {
      const avgLikes = totalHearts / videoCount;
      return parseFloat(((avgLikes / followers) * 100).toFixed(2));
    }
    return 0;
  }

  private calcAvgViews(videos: ApifyTikTokVideo[]): number {
    if (!videos.length) return 0;
    const total = videos.reduce((sum, v) => sum + (v.playCount ?? 0), 0);
    return Math.round(total / videos.length);
  }

  private async runActor(token: string, input: object): Promise<any[] | null> {
    const url = `${this.base}/acts/${this.actorId}/run-sync-get-dataset-items?token=${token}&timeout=60&memory=256`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      this.logger.warn(`Apify TikTok actor returned ${res.status}`);
      return null;
    }
    return res.json() as Promise<any[]>;
  }
}
