import { Module } from '@nestjs/common';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [PrismaModule, SyncModule],
  controllers: [InfluencersController],
  providers: [InfluencersService],
})
export class InfluencersModule {}
