import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ShortlistService } from './shortlist.service';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Shortlist')
@ApiBearerAuth('jwt')
@Controller('shortlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BRAND, UserRole.AGENCY)
export class ShortlistController {
  constructor(private readonly shortlistService: ShortlistService) {}

  @ApiOperation({ summary: 'Get the brand-global saved-influencers shortlist', description: 'Role: BRAND, AGENCY.' })
  @ApiResponse({ status: 200, description: 'Shortlisted influencers.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Get()
  getShortlist(@Request() req: any) {
    return this.shortlistService.getShortlist(req.user.userId);
  }

  @ApiOperation({ summary: 'Add an influencer to the shortlist', description: 'Role: BRAND, AGENCY.' })
  @ApiParam({ name: 'influencerId' })
  @ApiResponse({ status: 201, description: 'Added to shortlist.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Post(':influencerId')
  add(@Request() req: any, @Param('influencerId') influencerId: string) {
    return this.shortlistService.add(req.user.userId, influencerId);
  }

  @ApiOperation({ summary: 'Remove an influencer from the shortlist', description: 'Role: BRAND, AGENCY.' })
  @ApiParam({ name: 'influencerId' })
  @ApiResponse({ status: 200, description: 'Removed from shortlist.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Delete(':influencerId')
  remove(@Request() req: any, @Param('influencerId') influencerId: string) {
    return this.shortlistService.remove(req.user.userId, influencerId);
  }
}
