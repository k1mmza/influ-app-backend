import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, PlatformProfile } from './platform.adapter';

interface ApifyTikTokItem {
  id?: string;
  text?: string;
  webVideoUrl?: string;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  authorMeta?: {
    name?: string;
    nickName?: string;
    signature?: string;
    avatar?: string;
    originalAvatarUrl?: string;
    fans?: number;
    heart?: number;
    video?: number;
    verified?: boolean;
    bioLink?: string;
  };
  videoMeta?: {
    coverUrl?: string;
    originalCoverUrl?: string;
  };
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
        resultsPerPage: 5,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
      });

      if (!items?.length) return null;

      // Each item is a video; user profile is nested in authorMeta of the first item
      const firstItem = items[0] as ApifyTikTokItem;
      const author = firstItem.authorMeta;
      const videos = items as ApifyTikTokItem[];

      const followers = author?.fans ?? 0;
      const totalHearts = author?.heart ?? 0;
      const videoCount = author?.video ?? 0;

      const engagementRate = this.calcEngagementRate(
        videos,
        totalHearts,
        followers,
        videoCount,
      );
      const avgViews = this.calcAvgViews(videos);

      // Pick most-viewed video as spotlight
      const topVideo = videos.reduce<ApifyTikTokItem | null>(
        (best, v) =>
          best === null || (v.playCount ?? 0) > (best.playCount ?? 0)
            ? v
            : best,
        null,
      );
      const spotlightVideo = topVideo?.id
        ? {
            id: topVideo.id,
            title: topVideo.text?.substring(0, 100) ?? '',
            thumbnail:
              topVideo.videoMeta?.coverUrl ??
              topVideo.videoMeta?.originalCoverUrl ??
              '',
          }
        : undefined;

      return {
        handle: clean,
        displayName: author?.nickName ?? author?.name ?? clean,
        bio: author?.signature ?? null,
        followers,
        avgViews,
        engagementRate,
        growthRate: 0,
        profileUrl: `https://www.tiktok.com/@${clean}`,
        avatarUrl: author?.avatar ?? author?.originalAvatarUrl ?? undefined,
        spotlightVideo,
        videoTitles: videos
          .map((v) => v.text)
          .filter((t): t is string => !!t)
          .slice(0, 10),
        postEngagements: videos.map((v) => ({
          likes: v.diggCount ?? 0,
          comments: v.commentCount ?? 0,
          views: v.playCount ?? 0,
        })),
      };
    } catch (err: any) {
      this.logger.error(`TikTok fetch failed for "${handle}": ${err.message}`);
      return null;
    }
  }

  private calcEngagementRate(
    videos: ApifyTikTokItem[],
    totalHearts: number,
    followers: number,
    videoCount: number,
  ): number {
    if (videos.length > 0) {
      const totals = videos.reduce(
        (acc, v) => ({
          views: acc.views + (v.playCount ?? 0),
          eng:
            acc.eng +
            (v.diggCount ?? 0) +
            (v.commentCount ?? 0) +
            (v.shareCount ?? 0),
          count: acc.count + 1,
        }),
        { views: 0, eng: 0, count: 0 },
      );
      if (totals.views > 0) {
        return parseFloat(((totals.eng / totals.views) * 100).toFixed(2));
      }
    }
    if (followers > 0 && videoCount > 0) {
      const avgLikes = totalHearts / videoCount;
      return parseFloat(((avgLikes / followers) * 100).toFixed(2));
    }
    return 0;
  }

  private calcAvgViews(videos: ApifyTikTokItem[]): number {
    if (!videos.length) return 0;
    const total = videos.reduce((sum, v) => sum + (v.playCount ?? 0), 0);
    return Math.round(total / videos.length);
  }

  private async runActor(token: string, input: object): Promise<any[] | null> {
    const url = `${this.base}/acts/${this.actorId}/run-sync-get-dataset-items?token=${token}&timeout=60&memory=512`;
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
