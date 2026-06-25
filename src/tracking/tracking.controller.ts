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
import { TrackingService } from './tracking.service';
import { RecordResultDto } from './dto/record-result.dto';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get()
  getSummary(@Request() req: any) {
    return this.tracking.getSummary(req.user.userId);
  }

  @Get(':campaignId')
  getDetail(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.tracking.getDetail(req.user.userId, campaignId);
  }

  @Post(':campaignId/results')
  recordResult(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
    @Body() dto: RecordResultDto,
  ) {
    return this.tracking.recordResult(req.user.userId, campaignId, dto);
  }
}
