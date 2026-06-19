import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GenerateBriefDto } from './dto/generate-brief.dto';
import { SaveBriefDto } from './dto/save-brief.dto';
import { SmartPlanService } from './smart-plan.service';

@Controller('smart-plan')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmartPlanController {
  constructor(private readonly smartPlanService: SmartPlanService) {}

  /** Generate a campaign brief via AI. Restricted to BRAND and AGENCY roles. */
  @Post('generate')
  @Roles('BRAND', 'AGENCY')
  generate(@Body() dto: GenerateBriefDto) {
    return this.smartPlanService.generate(dto);
  }

  /** Save the current brief for the authenticated user (upsert — one brief per user). */
  @Post('save')
  @Roles('BRAND', 'AGENCY')
  saveBrief(@Request() req: any, @Body() dto: SaveBriefDto) {
    // JWT strategy maps sub → userId (not req.user.sub)
    return this.smartPlanService.saveBrief(req.user.userId, dto);
  }

  /** Fetch the user's last saved brief so the UI can restore it on page load. */
  @Get('brief')
  @Roles('BRAND', 'AGENCY')
  getLatestBrief(@Request() req: any) {
    return this.smartPlanService.getLatestBrief(req.user.userId);
  }
}
