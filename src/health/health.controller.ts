import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { INFLUENCER_SYNC_QUEUE } from '../sync/ttl.service';

type DepState = 'up' | 'down';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(INFLUENCER_SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  @ApiOperation({
    summary: 'Readiness check',
    description:
      'Public — no authentication required. Verifies the database (SELECT 1) and Redis (PING). Returns 200 only when both are reachable, otherwise 503. Use this (not GET /) as the deploy/reverse-proxy readiness probe.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service and all dependencies are up.',
  })
  @ApiResponse({
    status: 503,
    description: 'One or more dependencies are unreachable.',
  })
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const ok = db === 'up' && redis === 'up';
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', db, redis };
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
}
