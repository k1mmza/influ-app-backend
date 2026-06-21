import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ShortlistService } from './shortlist.service';

@Controller('shortlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BRAND, UserRole.AGENCY)
export class ShortlistController {
  constructor(private readonly shortlistService: ShortlistService) {}

  @Get()
  getShortlist(@Request() req: any) {
    return this.shortlistService.getShortlist(req.user.userId);
  }

  @Post(':influencerId')
  add(@Request() req: any, @Param('influencerId') influencerId: string) {
    return this.shortlistService.add(req.user.userId, influencerId);
  }

  @Delete(':influencerId')
  remove(@Request() req: any, @Param('influencerId') influencerId: string) {
    return this.shortlistService.remove(req.user.userId, influencerId);
  }
}
