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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InvitationsService } from './invitations.service';
import { InviteDto } from './dto/invite.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Invitations')
@ApiBearerAuth('jwt')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  // Brand/agency invites an influencer to one of their campaigns.
  @ApiOperation({ summary: 'Invite an influencer to a campaign', description: 'Role: BRAND, AGENCY. Creates or reuses an INVITED CampaignApplication row (origin=INVITATION).' })
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiResponse({ status: 201, description: 'Invitation created.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign or influencer not found.', type: ErrorResponseDto })
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
  @ApiOperation({ summary: 'List incoming invitations', description: 'Role: INFLUENCER.' })
  @ApiResponse({ status: 200, description: 'Invitation list (status=INVITED CampaignApplications).' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @Get('invitations')
  @Roles(UserRole.INFLUENCER)
  list(@Request() req: any) {
    return this.invitationsService.getInvitations(req.user.userId);
  }

  // Influencer accepts — flips INVITED → ACCEPTED and ensures a conversation exists.
  @ApiOperation({ summary: 'Accept an invitation', description: 'Role: INFLUENCER. Flips INVITED → ACCEPTED and ensures a conversation exists.' })
  @ApiParam({ name: 'id', description: 'CampaignApplication id' })
  @ApiResponse({ status: 201, description: 'Invitation accepted.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Invitation not found.', type: ErrorResponseDto })
  @Post('invitations/:id/accept')
  @Roles(UserRole.INFLUENCER)
  accept(@Request() req: any, @Param('id') applicationId: string) {
    return this.invitationsService.accept(req.user.userId, applicationId);
  }

  // Influencer declines — flips INVITED → DECLINED.
  @ApiOperation({ summary: 'Decline an invitation', description: 'Role: INFLUENCER. Flips INVITED → DECLINED.' })
  @ApiParam({ name: 'id', description: 'CampaignApplication id' })
  @ApiResponse({ status: 201, description: 'Invitation declined.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Invitation not found.', type: ErrorResponseDto })
  @Post('invitations/:id/decline')
  @Roles(UserRole.INFLUENCER)
  decline(@Request() req: any, @Param('id') applicationId: string) {
    return this.invitationsService.decline(req.user.userId, applicationId);
  }
}
