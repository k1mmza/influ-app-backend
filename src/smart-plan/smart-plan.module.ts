import { Module } from '@nestjs/common';
import { SmartPlanController } from './smart-plan.controller';
import { SmartPlanService } from './smart-plan.service';

@Module({
  controllers: [SmartPlanController],
  providers: [SmartPlanService],
})
export class SmartPlanModule {}
