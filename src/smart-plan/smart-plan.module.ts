import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SmartPlanController } from './smart-plan.controller';
import { SmartPlanService } from './smart-plan.service';

@Module({
  imports: [PrismaModule],
  controllers: [SmartPlanController],
  providers: [SmartPlanService, RolesGuard],
})
export class SmartPlanModule {}
