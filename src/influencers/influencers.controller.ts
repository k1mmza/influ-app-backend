import { Controller, Get, Query, Param, BadRequestException } from '@nestjs/common';
import { InfluencersService } from './influencers.service';

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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.influencersService.findOne(id);
  }
}
