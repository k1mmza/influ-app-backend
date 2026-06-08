import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const INFLUENCER_SYNC_QUEUE = 'influencer-sync';
export type SyncStatus = 'IDLE' | 'SYNCING';

@Injectable()
export class TtlService {
  constructor(private prisma: PrismaService) {}

  // ── Score ────────────────────────────────────────────────────────────────

  private async count30d(influencerId: string, type: string): Promise<number> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return this.prisma.profileEvent.count({
      where: { influencerId, type, createdAt: { gte: since } },
    });
  }

  async computeScore(influencerId: string): Promise<number> {
    const [views, campaigns, saves, searches] = await Promise.all([
      this.count30d(influencerId, 'VIEW'),
      this.count30d(influencerId, 'CAMPAIGN'),
      this.count30d(influencerId, 'SAVE'),
      this.count30d(influencerId, 'SEARCH'),
    ]);

    return (
      Math.log10(views + 1) * 0.35 +
      Math.log10(campaigns + 1) * 0.45 +
      Math.log10(saves + 1) * 0.15 +
      Math.log10(searches + 1) * 0.05
    );
  }

  // ── TTL days ─────────────────────────────────────────────────────────────

  scoreToDays(score: number): number {
    if (score >= 3) return 1;
    if (score >= 2) return 7;
    if (score >= 1) return 30;
    return 90;
  }

  nextRefreshAt(lastSyncedAt: Date, ttlDays: number): Date {
    return new Date(lastSyncedAt.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  }

  isExpired(nextRefreshAt: Date | null): boolean {
    if (!nextRefreshAt) return true;
    return Date.now() > nextRefreshAt.getTime();
  }

  // ── Main check ───────────────────────────────────────────────────────────

  /**
   * Called on every profile open.
   * Returns true if a sync job should be enqueued (expired + IDLE).
   * Also records a VIEW event.
   */
  async checkAndFlag(influencerId: string): Promise<boolean> {
    await this.recordEvent(influencerId, 'VIEW');

    const profile = await this.prisma.influencerProfile.findUnique({
      where: { id: influencerId },
      select: { syncStatus: true, lastSyncedAt: true, nextRefreshAt: true },
    });

    if (!profile) return false;
    if (profile.syncStatus === 'SYNCING') return false;
    if (!this.isExpired(profile.nextRefreshAt)) return false;

    return true;
  }

  // ── Event recording ──────────────────────────────────────────────────────

  async recordEvent(
    influencerId: string,
    type: 'VIEW' | 'SEARCH' | 'SAVE' | 'CAMPAIGN',
  ): Promise<void> {
    await this.prisma.profileEvent.create({
      data: { influencerId, type },
    });
  }

  // ── nextRefreshAt persistence ─────────────────────────────────────────────

  async updateNextRefresh(influencerId: string): Promise<void> {
    const score = await this.computeScore(influencerId);
    const ttlDays = this.scoreToDays(score);
    const now = new Date();
    await this.prisma.influencerProfile.update({
      where: { id: influencerId },
      data: {
        lastSyncedAt: now,
        nextRefreshAt: this.nextRefreshAt(now, ttlDays),
        syncStatus: 'IDLE',
      },
    });
  }
}
