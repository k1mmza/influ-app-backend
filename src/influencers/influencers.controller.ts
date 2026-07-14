import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InfluencersService } from './influencers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { InfluencerProfileResponseDto } from './dto/influencer-profile-response.dto';

@ApiTags('Influencers')
@Controller('influencers')
export class InfluencersController {
  constructor(private influencersService: InfluencersService) {}

  @ApiOperation({
    summary: 'Search/list influencers',
    description:
      'Public — no authentication required. Supports free-text `q` (AI-assisted: routed through SmartSearchService.parseQuery when present) plus explicit filter query params, which take priority over AI-derived filters.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Free-text search query; AI-parsed into filters when present.' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number, default 1.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page, default 15, max 60.' })
  @ApiResponse({
    status: 200,
    description: 'Paginated influencer list.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/InfluencerProfileResponseDto' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
        totalPages: { type: 'number' },
      },
    },
  })
  @Get()
  findAll(@Query() query: any) {
    return this.influencersService.findAll(query);
  }

  // Must be declared before :id to avoid route conflict
  @ApiOperation({ summary: 'Look up an influencer by platform + handle', description: 'Public — no authentication required.' })
  @ApiQuery({ name: 'platform', required: true, example: 'tiktok' })
  @ApiQuery({ name: 'handle', required: true, example: 'somecreator' })
  @ApiResponse({ status: 200, description: 'Match result, or { found: false } if no match exists.' })
  @ApiResponse({ status: 400, description: 'platform and handle are required.', type: ErrorResponseDto })
  @Get('lookup')
  lookup(@Query('platform') platform: string, @Query('handle') handle: string) {
    if (!platform || !handle) {
      throw new BadRequestException('platform and handle are required');
    }
    return this.influencersService.lookupByHandle(platform, handle);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get claim candidates for an external influencer profile', description: 'Authenticated. Returns external/unclaimed profiles that plausibly match the given influencer, for the claim flow.' })
  @ApiQuery({ name: 'influencerId', required: true })
  @ApiResponse({ status: 200, description: 'Candidate list.', type: [InfluencerProfileResponseDto] })
  @ApiResponse({ status: 400, description: 'influencerId is required.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @UseGuards(JwtAuthGuard)
  @Get('claim-candidates')
  getClaimCandidates(@Query('influencerId') influencerId: string) {
    if (!influencerId)
      throw new BadRequestException('influencerId is required');
    return this.influencersService.getClaimCandidates(influencerId);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Claim an external influencer profile',
    description:
      'Authenticated. Merges an external/unclaimed profile into the caller\'s own influencer profile.',
  })
  @ApiParam({ name: 'externalInfluencerId', description: 'Id of the external (unclaimed) InfluencerProfile to claim.' })
  @ApiBody({ schema: { type: 'object', properties: { claimerInfluencerId: { type: 'string' } }, required: ['claimerInfluencerId'] } })
  @ApiResponse({ status: 201, description: 'Profile claimed and merged.' })
  @ApiResponse({ status: 400, description: 'claimerInfluencerId is required.', type: ErrorResponseDto })
  @ApiResponse({
    status: 500,
    description:
      'Profile not found, target is not an external profile, or profile already claimed. The service throws a plain Error (not a Nest HttpException) for these cases, so Nest\'s default filter maps it to 500 rather than 404/400 — this reflects current behavior, not a documentation gap.',
    type: ErrorResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @UseGuards(JwtAuthGuard)
  @Post('claim/:externalInfluencerId')
  claimProfile(
    @Param('externalInfluencerId') externalInfluencerId: string,
    @Body('claimerInfluencerId') claimerInfluencerId: string,
  ) {
    if (!claimerInfluencerId)
      throw new BadRequestException('claimerInfluencerId is required');
    return this.influencersService.claimProfile(
      externalInfluencerId,
      claimerInfluencerId,
    );
  }

  @ApiOperation({
    summary: 'Get an influencer profile by id',
    description: 'Public — no authentication required. Returns null (200 OK) rather than a 404 if no profile matches the id.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Influencer profile, or null if not found.', type: InfluencerProfileResponseDto })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.influencersService.findOne(id);
  }
}
