export interface PlatformProfile {
  handle: string;
  displayName: string;
  bio: string | null;
  followers: number;
  avgViews: number;
  engagementRate: number;
  growthRate: number;
  profileUrl: string;
  avatarUrl?: string;
  latestVideo?: {
    id: string;
    title: string;
    thumbnail: string;
  };
}

export abstract class PlatformAdapter {
  abstract readonly platform: string;
  abstract fetchProfile(handle: string): Promise<PlatformProfile | null>;
}
