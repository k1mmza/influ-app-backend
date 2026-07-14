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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AddCampaignShortlistDto } from './dto/add-campaign-shortlist.dto';
import { UpdateCampaignShortlistDto } from './dto/update-campaign-shortlist.dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  getCampaigns(@Request() req: any) {
    return this.campaignsService.getCampaignsForUser(req.user.userId);
  }

  @Post()
  createCampaign(@Request() req: any, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.createCampaign(req.user.userId, dto);
  }

  @Get('public')
  getPublicCampaigns(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(12), ParseIntPipe) pageSize: number,
  ) {
    return this.campaignsService.getPublicCampaigns(page, pageSize);
  }

  @Get(':id')
  getCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.getCampaign(req.user.userId, id);
  }

  @Patch(':id')
  updateCampaign(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.updateCampaign(req.user.userId, id, dto);
  }

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

  @Delete(':id')
  deleteCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.deleteCampaign(req.user.userId, id);
  }

  @Post(':id/apply')
  applyToCampaign(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.applyToCampaign(req.user.userId, id);
  }

  @Get(':id/applications')
  getApplications(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.getApplications(req.user.userId, id);
  }

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
  @Post(':campaignId/share')
  createShareLink(
    @Request() req: any,
    @Param('campaignId') campaignId: string,
  ) {
    return this.campaignsService.createShareLink(req.user.userId, campaignId);
  }

  /** List the campaign's currently active (non-revoked, non-expired) links. */
  @Get(':campaignId/share')
  listShareLinks(@Request() req: any, @Param('campaignId') campaignId: string) {
    return this.campaignsService.listShareLinks(req.user.userId, campaignId);
  }

  /** Revoke a single link by id (kills just that URL). */
  @Delete('share/:linkId')
  revokeShareLink(@Request() req: any, @Param('linkId') linkId: string) {
    return this.campaignsService.revokeShareLink(req.user.userId, linkId);
  }

  // ── Campaign-scoped shortlist (client-review candidate list) ───────────────
  // Owner-only. Static `shortlist` segment keeps these unambiguous with the
  // `:id` routes above.

  /** The campaign's shortlist with per-influencer notes/prices. */
  @Get(':id/shortlist')
  getCampaignShortlist(@Request() req: any, @Param('id') id: string) {
    return this.campaignsService.getCampaignShortlist(req.user.userId, id);
  }

  /** Add an influencer to this campaign's shortlist. */
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
