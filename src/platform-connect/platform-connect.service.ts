import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { YouTubeStrategy } from './strategies/youtube.strategy';
import { TikTokStrategy } from './strategies/tiktok.strategy';
import { InstagramStrategy } from './strategies/instagram.strategy';
import type {
  IPlatformStrategy,
  PlatformChannelData,
  PlatformAnalyticsData,
  PlatformTokens,
} from './strategies/platform-strategy.interface';

@Injectable()
export class PlatformConnectService {
  private readonly logger = new Logger(PlatformConnectService.name);
  private readonly strategies: Map<string, IPlatformStrategy>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly youtube: YouTubeStrategy,
    private readonly tiktok: TikTokStrategy,
    private readonly instagram: InstagramStrategy,
  ) {
    this.strategies = new Map<string, IPlatformStrategy>([
      ['youtube', youtube],
      ['tiktok', tiktok],
      ['instagram', instagram],
    ]);
  }

  private get callbackUrl(): string {
    return (
      process.env.PLATFORM_CONNECT_CALLBACK_URL ||
      'http://localhost:3001/auth/platform/connect/callback'
    );
  }

  private strategy(platform: string): IPlatformStrategy {
    const s = this.strategies.get(platform.toLowerCase());
    if (!s) throw new BadRequestException(`Unsupported platform: ${platform}`);
    return s;
  }

  // ── 1. Generate OAuth URL ─────────────────────────────────────────────────

  getAuthUrl(userId: string, platform: string): string {
    this.strategy(platform); // validate early
    const state = this.jwtService.sign(
      { userId, platform: platform.toLowerCase(), purpose: 'platform-connect' },
      { expiresIn: '10m' },
    );
    return this.strategy(platform).getAuthUrl(state, this.callbackUrl);
  }

  // ── 2. Handle OAuth callback ──────────────────────────────────────────────

  async handleCallback(code: string, stateToken: string): Promise<string> {
    let payload: { userId: string; platform: string; purpose: string };
    try {
      payload = this.jwtService.verify(stateToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
    if (payload.purpose !== 'platform-connect') {
      throw new UnauthorizedException('Wrong OAuth purpose');
    }

    const { userId, platform } = payload;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { influencerProfile: true },
    });
    if (!user) throw new UnauthorizedException();
    if (user.role !== 'INFLUENCER')
      throw new ForbiddenException(
        'Only influencers can connect platform accounts',
      );
    if (!user.influencerProfile)
      throw new BadRequestException(
        'Complete your profile before linking a platform',
      );

    const strat = this.strategy(platform);
    // Pass state to exchangeCode so PKCE strategies (e.g. TikTok) can retrieve the code_verifier
    const tokens = await strat.exchangeCode(code, this.callbackUrl, stateToken);

    const accessToken = tokens.accessToken;
    const [channelData, analyticsData] = await Promise.all([
      strat.fetchChannelData(accessToken, tokens.platformUserId),
      strat.fetchAnalyticsData
        ? strat
            .fetchAnalyticsData(accessToken, tokens.platformUserId)
            .catch((e) => {
              this.logger.warn(
                `${platform} analytics fetch failed: ${e.message}`,
              );
              return null;
            })
        : Promise.resolve(null),
    ]);

    if (!channelData)
      throw new InternalServerErrorException(
        `Could not retrieve ${platform} account data`,
      );

    await this.persistAccount(
      user.influencerProfile.id,
      platform,
      tokens,
      channelData,
      analyticsData,
    );
    return userId;
  }

  // ── 3. Sync a linked account (called by SyncProcessor) ───────────────────

  async syncLinkedAccount(platformAccountId: string): Promise<void> {
    const account = await this.prisma.platformAccount.findUnique({
      where: { id: platformAccountId },
    });
    if (!account?.refreshToken) return;

    const strat = this.strategies.get(account.platform);
    if (!strat) return;

    let accessToken = account.accessToken!;
    const fiveMin = new Date(Date.now() + 5 * 60 * 1000);

    if (!account.tokenExpiry || account.tokenExpiry < fiveMin) {
      try {
        const refreshed = await strat.refreshAccessToken(account.refreshToken);
        accessToken = refreshed.accessToken;
        await this.prisma.platformAccount.update({
          where: { id: platformAccountId },
          data: {
            accessToken: refreshed.accessToken,
            tokenExpiry: refreshed.expiry,
          },
        });
      } catch (e: any) {
        this.logger.error(
          `Token refresh failed for account ${platformAccountId}: ${e.message}`,
        );
        return;
      }
    }

    const [channelData, analyticsData] = await Promise.all([
      strat.fetchChannelData(accessToken, account.channelId ?? undefined),
      strat.fetchAnalyticsData
        ? strat
            .fetchAnalyticsData(accessToken, account.channelId ?? undefined)
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!channelData) return;

    const profile = await this.prisma.influencerProfile.findFirst({
      where: { platformAccounts: { some: { id: platformAccountId } } },
    });
    if (!profile) return;

    const currentTokens: PlatformTokens = {
      accessToken,
      refreshToken: account.refreshToken,
      expiry: account.tokenExpiry ?? new Date(Date.now() + 3600 * 1000),
    };

    await this.persistAccount(
      profile.id,
      account.platform,
      currentTokens,
      channelData,
      analyticsData,
      platformAccountId,
    );

    this.logger.log(
      `OAuth sync complete for ${account.platform} account ${platformAccountId}`,
    );
  }

  // ── 4. Disconnect a platform ──────────────────────────────────────────────

  async disconnectPlatform(userId: string, platform: string): Promise<void> {
    await this.prisma.platformAccount.updateMany({
      where: {
        influencer: { userId },
        platform: platform.toLowerCase(),
      },
      data: { accessToken: null, refreshToken: null, tokenExpiry: null },
    });
  }

  // ── Private: common account persistence ──────────────────────────────────

  private async persistAccount(
    influencerId: string,
    platform: string,
    tokens: PlatformTokens,
    channel: PlatformChannelData,
    analytics: PlatformAnalyticsData | null,
    existingAccountId?: string,
  ) {
    const data: any = {
      platform,
      handle: channel.handle,
      displayName: channel.displayName,
      avatarUrl: channel.avatarUrl,
      profileUrl: channel.profileUrl,
      followers: channel.followers,
      avgViews: channel.avgViews,
      engagementRate: channel.engagementRate,
      channelId: channel.platformUserId,
      accessToken: tokens.accessToken,
      tokenExpiry: tokens.expiry,
      syncedAt: new Date(),
      // A successful (re)connect/sync persisted fresh tokens — this account is
      // healthy, so clear any needsReauth flag immediately (banner disappears
      // without waiting for the next daily sync). The tracking sync's
      // TikTokAuthError -> needsReauth=true catch re-flags it if revoked later.
      needsReauth: false,
      spotlightVideoId: channel.spotlightVideo?.id ?? null,
      spotlightVideoTitle: channel.spotlightVideo?.title ?? null,
      spotlightThumbnailUrl: channel.spotlightVideo?.thumbnail ?? null,
      ...(analytics && {
        watchTimeMins: analytics.watchTimeMins,
        avgViewDuration: analytics.avgViewDuration,
        avgViewPct: analytics.avgViewPct,
        subscribersGained: analytics.subscribersGained,
        topCountries: analytics.topCountries,
      }),
    };

    if (tokens.refreshToken) data.refreshToken = tokens.refreshToken;

    let account: any;
    if (existingAccountId) {
      account = await this.prisma.platformAccount.update({
        where: { id: existingAccountId },
        data,
      });
    } else {
      const existing = await this.prisma.platformAccount.findFirst({
        where: { influencerId, platform },
      });
      if (existing) {
        account = await this.prisma.platformAccount.update({
          where: { id: existing.id },
          data,
        });
      } else {
        account = await this.prisma.platformAccount.create({
          data: { influencerId, ...data },
        });
      }
    }

    if (
      analytics &&
      (analytics.malePct != null || analytics.femalePct != null)
    ) {
      const insightData = {
        malePct: analytics.malePct,
        femalePct: analytics.femalePct,
        ageDistribution: analytics.ageDistribution as any,
      };
      const insight = await this.prisma.audienceInsight.findFirst({
        where: { platformAccountId: account.id },
      });
      if (insight) {
        await this.prisma.audienceInsight.update({
          where: { id: insight.id },
          data: insightData,
        });
      } else {
        await this.prisma.audienceInsight.create({
          data: { platformAccountId: account.id, ...insightData },
        });
      }
    }

    if (channel.country || channel.bio) {
      await this.prisma.influencerProfile.update({
        where: { id: influencerId },
        data: {
          ...(channel.country && { country: channel.country }),
          ...(channel.bio && { bio: channel.bio }),
        },
      });
    }

    return account;
  }
}
