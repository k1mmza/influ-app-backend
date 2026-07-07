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
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

const COVER_DIR = `${process.env.UPLOAD_BASE_DIR || './uploads'}/campaign-covers`;

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
      storage: diskStorage({
        destination: (req, file, cb) => {
          try {
            if (!existsSync(COVER_DIR))
              mkdirSync(COVER_DIR, { recursive: true });
            cb(null, COVER_DIR);
          } catch (err) {
            cb(err as Error, COVER_DIR);
          }
        },
        filename: (req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
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
    const fileUrl = `/uploads/campaign-covers/${file.filename}`;
    return this.campaignsService.uploadCoverImage(req.user.userId, id, fileUrl);
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
}
