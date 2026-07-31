import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { HealthController } from './health.controller';

@Module({
  // SyncModule re-exports BullModule (the registered influencer-sync queue), so
  // the readiness check can reach Redis through the app's existing connection.
  // PrismaService is global (PrismaModule).
  imports: [SyncModule],
  controllers: [HealthController],
})
export class HealthModule {}
