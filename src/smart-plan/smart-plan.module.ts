import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { SmartPlanController } from './smart-plan.controller';
import { SmartPlanService } from './smart-plan.service';

@Module({
  imports: [PrismaModule, CampaignsModule], // CampaignsModule exports CampaignsService for reuse
  controllers: [SmartPlanController],
  providers: [SmartPlanService, RolesGuard],
})
export class SmartPlanModule {}
