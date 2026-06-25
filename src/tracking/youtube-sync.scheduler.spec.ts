/**
 * TEST PLAN — YoutubeSyncScheduler (the daily @Cron wrapper)
 * =========================================================
 * The only behavior worth pinning is the env gate: the handler must no-op when
 * YOUTUBE_SYNC_ENABLED is off and call syncYoutubeStats() when on.
 */

import { YoutubeSyncScheduler } from './youtube-sync.scheduler';

describe('YoutubeSyncScheduler', () => {
  const tracking = { syncYoutubeStats: jest.fn() };
  const scheduler = new YoutubeSyncScheduler(tracking as any);

  afterEach(() => {
    delete process.env.YOUTUBE_SYNC_ENABLED;
    jest.clearAllMocks();
  });

  it('no-ops when YOUTUBE_SYNC_ENABLED is unset (default OFF)', async () => {
    await scheduler.handleDailySync();
    expect(tracking.syncYoutubeStats).not.toHaveBeenCalled();
  });

  it('no-ops when YOUTUBE_SYNC_ENABLED is set to anything other than "true"', async () => {
    process.env.YOUTUBE_SYNC_ENABLED = 'false';
    await scheduler.handleDailySync();
    expect(tracking.syncYoutubeStats).not.toHaveBeenCalled();
  });

  it('runs the sync when YOUTUBE_SYNC_ENABLED=true', async () => {
    process.env.YOUTUBE_SYNC_ENABLED = 'true';
    tracking.syncYoutubeStats.mockResolvedValueOnce({ written: 3, skipped: 1 });
    await scheduler.handleDailySync();
    expect(tracking.syncYoutubeStats).toHaveBeenCalledTimes(1);
  });
});
