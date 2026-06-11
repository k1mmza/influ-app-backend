import { Module } from '@nestjs/common';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { AiAnalysisService } from './ai-analysis.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SyncModule } from '../sync/sync.module';
import { SmartSearchService } from './smart-search.service';

@Module({
  imports: [PrismaModule, SyncModule],
  controllers: [InfluencersController],
  providers: [InfluencersService, AiAnalysisService, SmartSearchService],
})
export class InfluencersModule {}
