import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  getCampaigns(@Request() req: any) {
    return this.campaignsService.getCampaignsForUser(req.user.userId);
  }

  @Get('public')
  getPublicCampaigns() {
    return this.campaignsService.getPublicCampaigns();
  }
}
