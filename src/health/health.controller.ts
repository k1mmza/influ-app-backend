import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { INFLUENCER_SYNC_QUEUE } from '../sync/ttl.service';

type DepState = 'up' | 'down';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(INFLUENCER_SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  @ApiOperation({
    summary: 'Readiness check',
    description:
      'Public — no authentication required. Verifies the database (SELECT 1), Redis (PING), and Supabase Storage (list one object). ' +
      'The 200/503 gate reflects DB + Redis only — the app cannot serve without them. Storage is REPORTED (storage: up|down) but NOT gated: ' +
      'a Storage outage degrades uploads/avatars, not core traffic, so it must not pull the whole API out of the reverse proxy. ' +
      'Use this (not GET /) as the deploy/reverse-proxy readiness probe.',
  })
  @ApiResponse({
    status: 200,
    description: 'Gating dependencies (DB + Redis) are up. Check the storage field for non-gating status.',
  })
  @ApiResponse({
    status: 503,
    description: 'A gating dependency (DB or Redis) is unreachable.',
  })
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [db, redis, storage] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkStorage(),
    ]);
    // Gate on DB + Redis only. Storage is reported but never gates readiness.
    const ok = db === 'up' && redis === 'up';
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', db, redis, storage };
  }

  private async checkDb(): Promise<DepState> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<DepState> {
    try {
      // Reuse BullMQ's existing ioredis connection rather than opening a new one.
      // BullMQ's IRedisClient type doesn't surface ping(), but the underlying
      // ioredis client does.
      const client = (await this.syncQueue.client) as unknown as {
        ping: () => Promise<string>;
      };
      const pong = await client.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  private async checkStorage(): Promise<DepState> {
    return (await this.storage.ping()) ? 'up' : 'down';
  }
}
