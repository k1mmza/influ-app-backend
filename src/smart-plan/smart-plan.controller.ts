import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GenerateBriefDto } from './dto/generate-brief.dto';
import { SaveBriefDto } from './dto/save-brief.dto';
import { CreateFromPlanDto } from './dto/create-from-plan.dto';
import { SmartPlanService } from './smart-plan.service';

// Same upload pipeline as campaign covers — local disk served via /uploads. The
// brief reference image is uploaded here (before a campaign exists) so its URL can
// be passed to POST /smart-plan/create-campaign. Display-only; never fed to the AI.
const BRIEF_IMAGE_DIR = `${process.env.UPLOAD_BASE_DIR || './uploads'}/brief-images`;

@Controller('smart-plan')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmartPlanController {
  constructor(private readonly smartPlanService: SmartPlanService) {}

  /** Upload a reference image for the brief; returns its served URL for the create-campaign payload. */
  @Post('brief-image')
  @Roles('BRAND', 'AGENCY')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          try {
            if (!existsSync(BRIEF_IMAGE_DIR))
              mkdirSync(BRIEF_IMAGE_DIR, { recursive: true });
            cb(null, BRIEF_IMAGE_DIR);
          } catch (err) {
            cb(err as Error, BRIEF_IMAGE_DIR);
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
  uploadBriefImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Image file is required');
    return { url: `/uploads/brief-images/${file.filename}` };
  }

  /** Generate a campaign brief + inferred campaign fields + provenance. No DB writes. */
  @Post('generate')
  @Roles('BRAND', 'AGENCY')
  generate(@Body() dto: GenerateBriefDto) {
    return this.smartPlanService.generate(dto);
  }

  /** Create a DRAFT campaign from confirmed plan fields and attach the brief. */
  @Post('create-campaign')
  @Roles('BRAND', 'AGENCY')
  createCampaign(@Request() req: any, @Body() dto: CreateFromPlanDto) {
    return this.smartPlanService.createCampaignFromPlan(req.user.userId, dto);
  }

  /** Save the current standalone brief for the authenticated user (brief-only workspace). */
  @Post('save')
  @Roles('BRAND', 'AGENCY')
  saveBrief(@Request() req: any, @Body() dto: SaveBriefDto) {
    // JWT strategy maps sub → userId (not req.user.sub)
    return this.smartPlanService.saveBrief(req.user.userId, dto);
  }

  /** Fetch the user's last saved STANDALONE brief so the UI can restore it on page load. */
  @Get('brief')
  @Roles('BRAND', 'AGENCY')
  getLatestBrief(@Request() req: any) {
    return this.smartPlanService.getLatestBrief(req.user.userId);
  }

  /** Fetch the brief attached to a specific campaign. */
  @Get('brief/by-campaign/:campaignId')
  @Roles('BRAND', 'AGENCY')
  getBriefByCampaign(@Param('campaignId') campaignId: string) {
    return this.smartPlanService.getBriefByCampaign(campaignId);
  }
}
