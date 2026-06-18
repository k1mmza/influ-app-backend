import { Body, Controller, Get, Param, Patch, Post, Delete, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  getCampaigns(@Request() req: any) {
    return this.campaignsService.getCampaignsForUser(req.user.userId);
  }

  @Post()
  createCampaign(@Request() req: any, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.createCampaign(req.user.userId, dto);
  }

  @Get('public')
  getPublicCampaigns() {
    return this.campaignsService.getPublicCampaigns();
  }

  @Get(':id')
  getCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.getCampaign(req.user.userId, id);
  }

  @Patch(':id')
  updateCampaign(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.updateCampaign(req.user.userId, id, dto);
  }

  @Delete(':id')
  deleteCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.deleteCampaign(req.user.userId, id);
  }

  @Post(':id/apply')
  applyToCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.applyToCampaign(req.user.userId, id);
  }

  @Get(':id/applications')
  getApplications(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.getApplications(req.user.userId, id);
  }

  @Patch(':id/applications/:applicationId')
  updateApplicationStatus(
    @Request() req: any,
    @Param('id') campaignId: string,
    @Param('applicationId') applicationId: string,
    @Body('status') status: string,
  ) {
    return this.campaignsService.updateApplicationStatus(req.user.userId, campaignId, applicationId, status);
  }
}
