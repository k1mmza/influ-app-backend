import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, PlatformProfile } from './platform.adapter';

interface YTChannelItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    customUrl?: string;
    country?: string;
    thumbnails: { high?: { url: string }; default?: { url: string } };
  };
  statistics: {
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
  };
  contentDetails: {
    relatedPlaylists: { uploads: string };
  };
}

interface YTListResponse<T> {
  items?: T[];
}

interface VideoStats {
  avgViews: number;
  engagementRate: number;
  spotlightVideo?: PlatformProfile['spotlightVideo'];
  topVideoIds: string[];
  videoTitles: string[];
}

@Injectable()
export class YouTubeAdapter extends PlatformAdapter {
  readonly platform = 'youtube';
  private readonly logger = new Logger(YouTubeAdapter.name);
  private readonly base = 'https://www.googleapis.com/youtube/v3';

  async fetchProfile(handle: string): Promise<PlatformProfile | null> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      this.logger.warn('YOUTUBE_API_KEY not set — skipping live fetch');
      return null;
    }

    try {
      const channel = await this.resolveChannel(handle, apiKey);
      if (!channel) return null;

      const subscribers = parseInt(channel.statistics.subscriberCount ?? '0', 10);
      const videoCount = parseInt(channel.statistics.videoCount ?? '0', 10);
      const totalViews = parseInt(channel.statistics.viewCount ?? '0', 10);
      const uploadsId = channel.contentDetails.relatedPlaylists.uploads;

      let avgViews = videoCount > 0 ? Math.round(totalViews / videoCount) : 0;
      let engagementRate = 0;
      let spotlightVideo: PlatformProfile['spotlightVideo'];
      let topVideoIds: string[] = [];
      let videoTitles: string[] = [];

      if (uploadsId) {
        const stats = await this.recentVideoStats(uploadsId, apiKey);
        if (stats.avgViews > 0) avgViews = stats.avgViews;
        engagementRate = stats.engagementRate;
        spotlightVideo = stats.spotlightVideo;
        topVideoIds = stats.topVideoIds;
        videoTitles = stats.videoTitles;
      }

      const cleanHandle =
        channel.snippet.customUrl?.replace(/^@/, '') ?? handle.replace(/^@/, '');

      const countryCode = channel.snippet.country;
      const country = countryCode
        ? new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? countryCode
        : undefined;

      return {
        handle: cleanHandle,
        displayName: channel.snippet.title,
        bio: channel.snippet.description || null,
        followers: subscribers,
        avgViews,
        engagementRate,
        growthRate: 0,
        profileUrl: `https://www.youtube.com/@${cleanHandle}`,
        country,
        avatarUrl:
          channel.snippet.thumbnails.high?.url ??
          channel.snippet.thumbnails.default?.url,
        spotlightVideo,
        topVideoIds,
        videoTitles,
      };
    } catch (err: any) {
      this.logger.error(`YouTube fetch failed for "${handle}": ${err.message}`);
      return null;
    }
  }

  // Try forHandle → channel ID → forUsername in sequence
  private async resolveChannel(
    handle: string,
    apiKey: string,
  ): Promise<YTChannelItem | null> {
    const clean = handle.replace(/^@/, '');
    const parts = 'snippet,statistics,contentDetails';

    const byHandle = await this.get<YTListResponse<YTChannelItem>>(
      `/channels?part=${parts}&forHandle=${encodeURIComponent(clean)}&key=${apiKey}`,
    );
    if (byHandle?.items?.length) return byHandle.items[0];

    if (clean.startsWith('UC')) {
      const byId = await this.get<YTListResponse<YTChannelItem>>(
        `/channels?part=${parts}&id=${encodeURIComponent(clean)}&key=${apiKey}`,
      );
      if (byId?.items?.length) return byId.items[0];
    }

    const byUsername = await this.get<YTListResponse<YTChannelItem>>(
      `/channels?part=${parts}&forUsername=${encodeURIComponent(clean)}&key=${apiKey}`,
    );
    if (byUsername?.items?.length) return byUsername.items[0];

    return null;
  }

  private async recentVideoStats(
    uploadsPlaylistId: string,
    apiKey: string,
  ): Promise<VideoStats> {
    // Fetch 50 recent uploads — enough to find a genuinely popular video
    const playlist = await this.get<YTListResponse<any>>(
      `/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=50&key=${apiKey}`,
    );
    if (!playlist?.items?.length) return { avgViews: 0, engagementRate: 0, topVideoIds: [], videoTitles: [] };

    const ids = playlist.items
      .map((i: any) => i.contentDetails?.videoId as string)
      .filter(Boolean)
      .join(',');

    if (!ids) return { avgViews: 0, engagementRate: 0, topVideoIds: [], videoTitles: [] };

    const videos = await this.get<YTListResponse<any>>(
      `/videos?part=statistics,snippet&id=${encodeURIComponent(ids)}&key=${apiKey}`,
    );
    if (!videos?.items?.length) return { avgViews: 0, engagementRate: 0, topVideoIds: [], videoTitles: [] };

    const totals = videos.items.reduce(
      (acc: any, v: any) => ({
        views: acc.views + parseInt(v.statistics?.viewCount ?? '0', 10),
        likes: acc.likes + parseInt(v.statistics?.likeCount ?? '0', 10),
        comments: acc.comments + parseInt(v.statistics?.commentCount ?? '0', 10),
        count: acc.count + 1,
      }),
      { views: 0, likes: 0, comments: 0, count: 0 },
    );

    if (totals.count === 0) return { avgViews: 0, engagementRate: 0, topVideoIds: [], videoTitles: [] };

    const avgViews = Math.round(totals.views / totals.count);
    const engagementRate =
      totals.views > 0
        ? parseFloat(
            (((totals.likes + totals.comments) / totals.views) * 100).toFixed(2),
          )
        : 0;

    // Sort videos by view count descending
    const sortedVideos = [...videos.items].sort(
      (a: any, b: any) =>
        parseInt(b.statistics?.viewCount ?? '0', 10) -
        parseInt(a.statistics?.viewCount ?? '0', 10),
    );

    const topVideo = sortedVideos[0];

    const spotlightVideo: PlatformProfile['spotlightVideo'] = topVideo
      ? {
          id: topVideo.id as string,
          title: (topVideo.snippet?.title as string) ?? 'Top Video',
          thumbnail:
            (topVideo.snippet?.thumbnails?.maxres?.url as string) ??
            (topVideo.snippet?.thumbnails?.high?.url as string) ??
            (topVideo.snippet?.thumbnails?.medium?.url as string) ??
            `https://img.youtube.com/vi/${topVideo.id}/mqdefault.jpg`,
        }
      : undefined;

    const topVideoIds = sortedVideos
      .map((v: any) => v.id as string)
      .filter(Boolean)
      .slice(0, 10);

    const videoTitles = sortedVideos
      .map((v: any) => v.snippet?.title as string)
      .filter(Boolean)
      .slice(0, 10);

    return { avgViews, engagementRate, spotlightVideo, topVideoIds, videoTitles };
  }

  private async get<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.base}${path}`);
    if (!res.ok) {
      this.logger.warn(`YouTube API ${res.status} for ${path.split('?')[0]}`);
      return null;
    }
    return res.json() as Promise<T>;
  }
}
