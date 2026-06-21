import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GenerateBriefDto } from './dto/generate-brief.dto';
import { SaveBriefDto } from './dto/save-brief.dto';
import { CreateFromPlanDto } from './dto/create-from-plan.dto';
import { SmartPlanService } from './smart-plan.service';

@Controller('smart-plan')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmartPlanController {
  constructor(private readonly smartPlanService: SmartPlanService) {}

  /** Generate a campaign brief + inferred campaign fields + provenance. No DB writes. */
  @Post('generate')
  @Roles('BRAND', 'AGENCY')
  generate(@Body() dto: GenerateBriefDto) {
    return this.smartPlanService.generate(dto);
  }

  /** Create a DRAFT campaign from confirmed plan fields and attach the brief. */
  @Post('create-campaign')
  @Roles('BRAND', 'AGENCY')
  createCampaign(@Request() req: any, @Body() dto: CreateFromPlanDto) {
    return this.smartPlanService.createCampaignFromPlan(req.user.userId, dto);
  }

  /** Save the current standalone brief for the authenticated user (brief-only workspace). */
  @Post('save')
  @Roles('BRAND', 'AGENCY')
  saveBrief(@Request() req: any, @Body() dto: SaveBriefDto) {
    // JWT strategy maps sub → userId (not req.user.sub)
    return this.smartPlanService.saveBrief(req.user.userId, dto);
  }

  /** Fetch the user's last saved STANDALONE brief so the UI can restore it on page load. */
  @Get('brief')
  @Roles('BRAND', 'AGENCY')
  getLatestBrief(@Request() req: any) {
    return this.smartPlanService.getLatestBrief(req.user.userId);
  }

  /** Fetch the brief attached to a specific campaign. */
  @Get('brief/by-campaign/:campaignId')
  @Roles('BRAND', 'AGENCY')
  getBriefByCampaign(@Param('campaignId') campaignId: string) {
    return this.smartPlanService.getBriefByCampaign(campaignId);
  }
}
