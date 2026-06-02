import { Controller, Get, Query, Param } from '@nestjs/common';
import { InfluencersService } from './influencers.service';

@Controller('influencers')
export class InfluencersController {
  constructor(private influencersService: InfluencersService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.influencersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.influencersService.findOne(id);
  }
}
