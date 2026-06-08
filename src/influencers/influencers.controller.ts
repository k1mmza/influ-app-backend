import { Controller, Get, Post, Query, Param, Body, BadRequestException, UseGuards } from '@nestjs/common';
import { InfluencersService } from './influencers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('influencers')
export class InfluencersController {
  constructor(private influencersService: InfluencersService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.influencersService.findAll(query);
  }

  // Must be declared before :id to avoid route conflict
  @Get('lookup')
  lookup(
    @Query('platform') platform: string,
    @Query('handle') handle: string,
  ) {
    if (!platform || !handle) {
      throw new BadRequestException('platform and handle are required');
    }
    return this.influencersService.lookupByHandle(platform, handle);
  }

  @UseGuards(JwtAuthGuard)
  @Get('claim-candidates')
  getClaimCandidates(@Query('influencerId') influencerId: string) {
    if (!influencerId) throw new BadRequestException('influencerId is required');
    return this.influencersService.getClaimCandidates(influencerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('claim/:externalInfluencerId')
  claimProfile(
    @Param('externalInfluencerId') externalInfluencerId: string,
    @Body('claimerInfluencerId') claimerInfluencerId: string,
  ) {
    if (!claimerInfluencerId) throw new BadRequestException('claimerInfluencerId is required');
    return this.influencersService.claimProfile(externalInfluencerId, claimerInfluencerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.influencersService.findOne(id);
  }
}
