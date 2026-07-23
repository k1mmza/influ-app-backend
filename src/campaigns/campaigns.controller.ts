import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Delete,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AddCampaignShortlistDto } from './dto/add-campaign-shortlist.dto';
import { UpdateCampaignShortlistDto } from './dto/update-campaign-shortlist.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ShareLinkResponseDto } from '../common/dto/share-link-response.dto';

@ApiTags('Campaigns')
@ApiBearerAuth('jwt')
@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @ApiOperation({ summary: 'List campaigns for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Campaign list.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Get()
  getCampaigns(@Request() req: any) {
    return this.campaignsService.getCampaignsForUser(req.user.userId);
  }

  @ApiOperation({ summary: 'Create a campaign', description: 'Creates a new campaign owned by the authenticated brand/agency user\'s client brand.' })
  @ApiResponse({ status: 201, description: 'Campaign created.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Invalid client brand, or caller does not own it.', type: ErrorResponseDto })
  @Post()
  createCampaign(@Request() req: any, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.createCampaign(req.user.userId, dto);
  }

  @ApiOperation({ summary: 'List publicly visible campaigns', description: 'Despite the path name, this still requires a valid bearer token (sits behind the controller-level JwtAuthGuard) — it lists campaigns with visibility=PUBLIC, not an unauthenticated endpoint.' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Default 1.' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Default 12.' })
  @ApiResponse({ status: 200, description: 'Paginated public campaign list.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Get('public')
  getPublicCampaigns(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(12), ParseIntPipe) pageSize: number,
  ) {
    return this.campaignsService.getPublicCampaigns(page, pageSize);
  }

  @ApiOperation({ summary: 'Get a campaign by id' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Campaign detail.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Get(':id')
  getCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.getCampaign(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Update a campaign' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Campaign updated.' })
  @ApiResponse({ status: 400, description: 'Validation failed, or invalid status transition.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Patch(':id')
  updateCampaign(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.updateCampaign(req.user.userId, id, dto);
  }

  @ApiOperation({ summary: 'Upload campaign cover image', description: 'Max 5MB. Accepts image/jpeg, image/png, image/webp, image/gif.' })
  @ApiParam({ name: 'id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'Cover uploaded; returns the new coverImageUrl.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Post(':id/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  uploadCover(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.campaignsService.uploadCoverImage(req.user.userId, id, file);
  }

  // Upload + persist a brief reference image onto an existing campaign in one call
  // (campaignId is known here). Mirrors the cover upload; display-only, not fed to AI.
  @ApiOperation({ summary: 'Upload campaign brief reference image', description: 'Max 5MB. Accepts image/jpeg, image/png, image/webp, image/gif. Display-only reference shown in the conversation brief — distinct from the public cover image, not fed to AI generation.' })
  @ApiParam({ name: 'id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'Brief image uploaded; returns the new briefImageUrl.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Post(':id/brief-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  uploadBriefImage(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.campaignsService.uploadBriefImage(req.user.userId, id, file);
  }

  @ApiOperation({ summary: 'Delete a campaign brief/product image', description: 'Removes one image (by url) from the campaign brief gallery and deletes the stored object.' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } })
  @ApiResponse({ status: 200, description: 'Image removed; returns the updated campaign.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign or image not found.', type: ErrorResponseDto })
  @Delete(':id/brief-image')
  deleteBriefImage(
    @Request() req: any,
    @Param('id') id: string,
    @Body('url') url: string,
  ) {
    return this.campaignsService.deleteBriefImage(req.user.userId, id, url);
  }

  @ApiOperation({ summary: 'Delete a campaign' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Campaign deleted.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Delete(':id')
  deleteCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.deleteCampaign(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Apply to a campaign', description: 'Role: INFLUENCER (enforced in service, not a @Roles decorator). Creates a PENDING CampaignApplication.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, description: 'Application created.' })
  @ApiResponse({ status: 400, description: 'Already applied, or campaign not accepting applications.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not an influencer, or campaign is private.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Post(':id/apply')
  applyToCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.applyToCampaign(req.user.userId, id);
  }

  @ApiOperation({ summary: 'List applications for a campaign', description: 'Owner-only.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Application list.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Get(':id/applications')
  getApplications(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.getApplications(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Update an application\'s status', description: 'Owner-only. Valid statuses: PENDING, INVITED, ACCEPTED, REJECTED, DECLINED.' })
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiParam({ name: 'applicationId' })
  @ApiBody({ schema: { type: 'object', properties: { status: { type: 'string', enum: ['PENDING', 'INVITED', 'ACCEPTED', 'REJECTED', 'DECLINED'] } } } })
  @ApiResponse({ status: 200, description: 'Application updated.' })
  @ApiResponse({ status: 400, description: 'Invalid application status.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign or application not found (caller not owning the campaign also surfaces as 404).', type: ErrorResponseDto })
  @Patch(':id/applications/:applicationId')
  updateApplicationStatus(
    @Request() req: any,
    @Param('id') campaignId: string,
    @Param('applicationId') applicationId: string,
    @Body('status') status: string,
  ) {
    return this.campaignsService.updateApplicationStatus(
      req.user.userId,
      campaignId,
      applicationId,
      status,
    );
  }

  // ── Public "Share Campaign" link management (owner-only; the token they mint
  // is consumed by the UNGUARDED PublicCampaignController). Distinct path depths
  // from the :id routes above, so no route ambiguity. ─────────────────────────

  /** Mint a new public share link for this campaign. */
  @ApiOperation({ summary: 'Create a public campaign share link', description: 'Owner-only. The token is consumed by the unauthenticated GET /public/campaigns/:token.' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 201, description: 'Share link created.', type: ShareLinkResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Post(':campaignId/share')
  createShareLink(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
  ) {
    return this.campaignsService.createShareLink(req.user.userId, campaignId);
  }

  /** List the campaign's currently active (non-revoked, non-expired) links. */
  @ApiOperation({ summary: 'List active campaign share links', description: 'Owner-only. Only currently-usable links (revokedAt is null and expiresAt is null or in the future).' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 200, description: 'Active share links.', type: [ShareLinkResponseDto] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Get(':campaignId/share')
  listShareLinks(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.campaignsService.listShareLinks(req.user.userId, campaignId);
  }

  /** Revoke a single link by id (kills just that URL). */
  @ApiOperation({ summary: 'Revoke a campaign share link', description: 'Owner-only. Sets revokedAt; other links minted for the same campaign are unaffected.' })
  @ApiParam({ name: 'linkId' })
  @ApiResponse({ status: 200, description: 'Link revoked.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Share link not found.', type: ErrorResponseDto })
  @Delete('share/:linkId')
  revokeShareLink(@Request() req: any, @Param('linkId') linkId: string) {
    return this.campaignsService.revokeShareLink(req.user.userId, linkId);
  }

  // ── Campaign-scoped shortlist (client-review candidate list) ───────────────
  // Owner-only. Static `shortlist` segment keeps these unambiguous with the
  // `:id` routes above.

  /** The campaign's shortlist with per-influencer notes/prices. */
  @ApiOperation({ summary: 'Get a campaign\'s shortlist', description: 'Owner-only. Per-influencer recommendation notes and proposed prices for client review.' })
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiResponse({ status: 200, description: 'Shortlist entries.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Get(':id/shortlist')
  getCampaignShortlist(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.getCampaignShortlist(req.user.userId, id);
  }

  /** Add an influencer to this campaign's shortlist. */
  @ApiOperation({ summary: 'Add an influencer to a campaign\'s shortlist', description: 'Owner-only.' })
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiResponse({ status: 201, description: 'Added to shortlist.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign or influencer not found.', type: ErrorResponseDto })
  @Post(':id/shortlist')
  addToCampaignShortlist(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AddCampaignShortlistDto,
  ) {
    return this.campaignsService.addToCampaignShortlist(
      req.user.userId,
      id,
      dto,
    );
  }

  /** Update the recommendation note / proposed price for one influencer. */
  @ApiOperation({ summary: 'Update a shortlist entry\'s note/price', description: 'Owner-only.' })
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiParam({ name: 'influencerId' })
  @ApiResponse({ status: 200, description: 'Shortlist entry updated.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign or shortlist entry not found.', type: ErrorResponseDto })
  @Patch(':id/shortlist/:influencerId')
  updateCampaignShortlistNote(
    @Request() req: any,
    @Param('id') id: string,
    @Param('influencerId') influencerId: string,
    @Body() dto: UpdateCampaignShortlistDto,
  ) {
    return this.campaignsService.updateCampaignShortlistNote(
      req.user.userId,
      id,
      influencerId,
      dto,
    );
  }

  /** Remove an influencer from this campaign's shortlist. */
  @ApiOperation({ summary: 'Remove an influencer from a campaign\'s shortlist', description: 'Owner-only.' })
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiParam({ name: 'influencerId' })
  @ApiResponse({ status: 200, description: 'Removed from shortlist.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign or shortlist entry not found.', type: ErrorResponseDto })
  @Delete(':id/shortlist/:influencerId')
  removeFromCampaignShortlist(
    @Request() req: any,
    @Param('id') id: string,
    @Param('influencerId') influencerId: string,
  ) {
    return this.campaignsService.removeFromCampaignShortlist(
      req.user.userId,
      id,
      influencerId,
    );
  }

  // ── Public influencers-preview share link management (owner-only; the token
  // is consumed by the UNGUARDED PublicCampaignController). Separate from the
  // brief-share links above so the two surfaces revoke independently. ─────────

  /** Mint a new public influencers-preview link for this campaign. */
  @ApiOperation({ summary: 'Create a public shortlist share link', description: 'Owner-only. The token is consumed by the unauthenticated GET /public/campaigns/:token/influencers. Separate token namespace from the campaign brief share link.' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 201, description: 'Shortlist share link created.', type: ShareLinkResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Post(':campaignId/shortlist-share')
  createShortlistShareLink(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
  ) {
    return this.campaignsService.createShortlistShareLink(
      req.user.userId,
      campaignId,
    );
  }

  /** List the campaign's active influencers-preview links. */
  @ApiOperation({ summary: 'List active shortlist share links', description: 'Owner-only. Only currently-usable links.' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 200, description: 'Active shortlist share links.', type: [ShareLinkResponseDto] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Campaign not found.', type: ErrorResponseDto })
  @Get(':campaignId/shortlist-share')
  listShortlistShareLinks(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
  ) {
    return this.campaignsService.listShortlistShareLinks(
      req.user.userId,
      campaignId,
    );
  }

  /** Revoke a single influencers-preview link by id. */
  @ApiOperation({ summary: 'Revoke a shortlist share link', description: 'Owner-only.' })
  @ApiParam({ name: 'linkId' })
  @ApiResponse({ status: 200, description: 'Link revoked.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Share link not found.', type: ErrorResponseDto })
  @Delete('shortlist-share/:linkId')
  revokeShortlistShareLink(
    @Request() req: any,
    @Param('linkId') linkId: string,
  ) {
    return this.campaignsService.revokeShortlistShareLink(
      req.user.userId,
      linkId,
    );
  }
}
