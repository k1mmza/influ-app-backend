import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, PlatformProfile } from './platform.adapter';

interface ApifyInstagramProfile {
  username?: string;
  fullName?: string;
  biography?: string;
  profilePicUrlHd?: string;
  profilePicUrl?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  isVerified?: boolean;
  latestPosts?: ApifyInstagramPost[];
}

interface ApifyInstagramPost {
  shortCode?: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
  displayUrl?: string;
  type?: string;
}

@Injectable()
export class InstagramAdapter extends PlatformAdapter {
  readonly platform = 'instagram';
  private readonly logger = new Logger(InstagramAdapter.name);
  private readonly base = 'https://api.apify.com/v2';
  private readonly actorId = 'apify~instagram-profile-scraper';

  async fetchProfile(handle: string): Promise<PlatformProfile | null> {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
      this.logger.warn('APIFY_API_TOKEN not set — skipping Instagram fetch');
      return null;
    }

    const clean = handle.replace(/^@/, '');

    try {
      const items = await this.runActor(token, {
        usernames: [clean],
        resultsLimit: 5,
      });
      if (!items?.length) return null;

      const profile = items[0] as ApifyInstagramProfile;
      const followers = profile.followersCount ?? 0;
      const posts = profile.latestPosts ?? [];

      // ER = (avg likes + avg comments) / followers × 100
      const engagementRate = this.calcEngagementRate(posts, followers);
      const avgViews = this.calcAvgViews(posts, followers);

      // Pick most-liked post as spotlight
      const topPost = posts.reduce<ApifyInstagramPost | null>(
        (best, p) =>
          best === null || (p.likesCount ?? 0) > (best.likesCount ?? 0)
            ? p
            : best,
        null,
      );
      const spotlightVideo = topPost?.shortCode
        ? {
            id: topPost.shortCode,
            title: topPost.caption?.substring(0, 100) ?? '',
            thumbnail: topPost.displayUrl ?? '',
          }
        : undefined;

      return {
        handle: clean,
        displayName: profile.fullName ?? clean,
        bio: profile.biography ?? null,
        followers,
        avgViews,
        engagementRate,
        growthRate: 0,
        profileUrl: `https://www.instagram.com/${clean}/`,
        avatarUrl:
          profile.profilePicUrlHd ?? profile.profilePicUrl ?? undefined,
        spotlightVideo,
        videoTitles: posts
          .map((p) => p.caption)
          .filter((c): c is string => !!c)
          .slice(0, 10),
        postEngagements: posts.map((p) => ({
          likes: p.likesCount ?? 0,
          comments: p.commentsCount ?? 0,
        })),
      };
    } catch (err: any) {
      this.logger.error(
        `Instagram fetch failed for "${handle}": ${err.message}`,
      );
      return null;
    }
  }

  private calcEngagementRate(
    posts: ApifyInstagramPost[],
    followers: number,
  ): number {
    if (!posts.length || followers === 0) return 0;
    const total = posts.reduce(
      (acc, p) => ({
        likes: acc.likes + (p.likesCount ?? 0),
        comments: acc.comments + (p.commentsCount ?? 0),
        count: acc.count + 1,
      }),
      { likes: 0, comments: 0, count: 0 },
    );
    if (total.count === 0) return 0;
    const avgEng = (total.likes + total.comments) / total.count;
    return parseFloat(((avgEng / followers) * 100).toFixed(2));
  }

  // Instagram has no views — use likes as a reach proxy
  private calcAvgViews(posts: ApifyInstagramPost[], followers: number): number {
    if (!posts.length) return Math.round(followers * 0.1); // 10% reach estimate
    const totalLikes = posts.reduce((sum, p) => sum + (p.likesCount ?? 0), 0);
    return Math.round(totalLikes / posts.length);
  }

  private async runActor(token: string, input: object): Promise<any[] | null> {
    const url = `${this.base}/acts/${this.actorId}/run-sync-get-dataset-items?token=${token}&timeout=60&memory=512`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      this.logger.warn(`Apify Instagram actor returned ${res.status}`);
      return null;
    }
    return res.json() as Promise<any[]>;
  }
}
