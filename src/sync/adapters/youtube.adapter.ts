import { Injectable } from '@nestjs/common';
import { PlatformAdapter, PlatformProfile } from './platform.adapter';

@Injectable()
export class YouTubeAdapter extends PlatformAdapter {
  readonly platform = 'youtube';

  async fetchProfile(handle: string): Promise<PlatformProfile | null> {
    // TODO: integrate YouTube Data API v3 once credentials are available
    return null;
  }
}
