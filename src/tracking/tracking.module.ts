import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
  imports: [PrismaModule, CampaignsModule], // CampaignsService provides ownership checks
  controllers: [TrackingController],
  providers: [TrackingService],
})
export class TrackingModule {}
