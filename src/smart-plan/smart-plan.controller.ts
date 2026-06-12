import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerateBriefDto } from './dto/generate-brief.dto';
import { SmartPlanService } from './smart-plan.service';

@Controller('smart-plan')
@UseGuards(JwtAuthGuard)
export class SmartPlanController {
  constructor(private readonly smartPlanService: SmartPlanService) {}

  @Post('generate')
  generate(@Body() dto: GenerateBriefDto) {
    return this.smartPlanService.generate(dto);
  }
}
