export interface PostEngagement {
  likes: number;
  comments: number;
  views?: number;
}

export interface PlatformProfile {
  handle: string;
  displayName: string;
  bio: string | null;
  followers: number;
  avgViews: number;
  engagementRate: number;
  growthRate: number;
  profileUrl: string;
  country?: string;
  avatarUrl?: string;
  spotlightVideo?: {
    id: string;
    title: string;
    thumbnail: string;
  };
  topVideoIds?: string[];
  videoTitles?: string[];
  postEngagements?: PostEngagement[];
}

export abstract class PlatformAdapter {
  abstract readonly platform: string;
  abstract fetchProfile(handle: string): Promise<PlatformProfile | null>;
}
