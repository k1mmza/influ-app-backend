import { Injectable } from '@nestjs/common';
import { PlatformAdapter, PlatformProfile } from './platform.adapter';

@Injectable()
export class TikTokAdapter extends PlatformAdapter {
  readonly platform = 'tiktok';

  async fetchProfile(handle: string): Promise<PlatformProfile | null> {
    // TODO: integrate TikTok API once credentials are available
    return null;
  }
}
