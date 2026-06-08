import { Injectable } from '@nestjs/common';
import { PlatformAdapter, PlatformProfile } from './platform.adapter';

@Injectable()
export class InstagramAdapter extends PlatformAdapter {
  readonly platform = 'instagram';

  async fetchProfile(handle: string): Promise<PlatformProfile | null> {
    // TODO: integrate Instagram Graph API once credentials are available
    return null;
  }
}
