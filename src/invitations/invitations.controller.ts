import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InvitationsService } from './invitations.service';
import { InviteDto } from './dto/invite.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  // Brand/agency invites an influencer to one of their campaigns.
  @Post('campaigns/:id/invite')
  @Roles(UserRole.BRAND, UserRole.AGENCY)
  invite(
    @Request() req: any,
    @Param('id') campaignId: string,
    @Body() dto: InviteDto,
  ) {
    return this.invitationsService.invite(
      req.user.userId,
      campaignId,
      dto.influencerId,
    );
  }

  // Influencer's incoming invitations.
  @Get('invitations')
  @Roles(UserRole.INFLUENCER)
  list(@Request() req: any) {
    return this.invitationsService.getInvitations(req.user.userId);
  }

  // Influencer accepts — flips INVITED → ACCEPTED and ensures a conversation exists.
  @Post('invitations/:id/accept')
  @Roles(UserRole.INFLUENCER)
  accept(@Request() req: any, @Param('id') applicationId: string) {
    return this.invitationsService.accept(req.user.userId, applicationId);
  }

  // Influencer declines — flips INVITED → DECLINED.
  @Post('invitations/:id/decline')
  @Roles(UserRole.INFLUENCER)
  decline(@Request() req: any, @Param('id') applicationId: string) {
    return this.invitationsService.decline(req.user.userId, applicationId);
  }
}
