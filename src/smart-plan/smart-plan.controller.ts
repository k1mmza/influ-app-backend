import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GenerateBriefDto } from './dto/generate-brief.dto';
import { SaveBriefDto } from './dto/save-brief.dto';
import { CreateFromPlanDto } from './dto/create-from-plan.dto';
import { SmartPlanService } from './smart-plan.service';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { SmartPlanBriefResponseDto } from './dto/smart-plan-brief-response.dto';

@ApiTags('Smart Plan')
@ApiBearerAuth('jwt')
@Controller('smart-plan')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmartPlanController {
  constructor(private readonly smartPlanService: SmartPlanService) {}

  /** Upload a reference image for the brief; returns its served URL for the create-campaign payload. */
  @ApiOperation({ summary: 'Upload a brief reference image', description: 'Role: BRAND, AGENCY. Max 5MB. Accepts image/jpeg, image/png, image/webp, image/gif. Returns a served URL for the create-campaign payload.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'Image uploaded; returns its URL.' })
  @ApiResponse({ status: 400, description: 'Image file is required.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Post('brief-image')
  @Roles('BRAND', 'AGENCY')
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
  uploadBriefImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Image file is required');
    return this.smartPlanService.uploadBriefImage(file);
  }

  /** Generate a campaign brief + inferred campaign fields + provenance. No DB writes. */
  @ApiOperation({
    summary: 'AI-generate a campaign brief',
    description: 'Role: BRAND, AGENCY. AI-assisted: generates a strategy/concept/brief and inferred campaign fields from the given inputs. No DB writes — the result is confirmed via a separate POST /smart-plan/create-campaign or /smart-plan/save call.',
  })
  @ApiResponse({ status: 201, description: 'Generated brief, inferred campaign fields, and provenance.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Post('generate')
  @Roles('BRAND', 'AGENCY')
  generate(@Body() dto: GenerateBriefDto) {
    return this.smartPlanService.generate(dto);
  }

  /** Create a DRAFT campaign from confirmed plan fields and attach the brief. */
  @ApiOperation({ summary: 'Create a campaign from a confirmed plan', description: 'Role: BRAND, AGENCY. Creates a DRAFT campaign from user-confirmed plan fields and attaches the brief.' })
  @ApiResponse({ status: 201, description: 'Draft campaign created with the brief attached.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Post('create-campaign')
  @Roles('BRAND', 'AGENCY')
  createCampaign(@Request() req: any, @Body() dto: CreateFromPlanDto) {
    return this.smartPlanService.createCampaignFromPlan(req.user.userId, dto);
  }

  /** Save the current standalone brief for the authenticated user (brief-only workspace). */
  @ApiOperation({ summary: 'Save the standalone brief', description: 'Role: BRAND, AGENCY. Saves the current brief for the caller\'s standalone workspace (no campaign required).' })
  @ApiResponse({ status: 201, description: 'Brief saved.', type: SmartPlanBriefResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Post('save')
  @Roles('BRAND', 'AGENCY')
  saveBrief(@Request() req: any, @Body() dto: SaveBriefDto) {
    // JWT strategy maps sub → userId (not req.user.sub)
    return this.smartPlanService.saveBrief(req.user.userId, dto);
  }

  /** Fetch the user's last saved STANDALONE brief so the UI can restore it on page load. */
  @ApiOperation({ summary: 'Get the caller\'s latest standalone brief', description: 'Role: BRAND, AGENCY.' })
  @ApiResponse({ status: 200, description: 'Latest standalone brief, or null if none saved.', type: SmartPlanBriefResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Get('brief')
  @Roles('BRAND', 'AGENCY')
  getLatestBrief(@Request() req: any) {
    return this.smartPlanService.getLatestBrief(req.user.userId);
  }

  /** Fetch the brief attached to a specific campaign. */
  @ApiOperation({ summary: 'Get the brief attached to a campaign', description: 'Role: BRAND, AGENCY.' })
  @ApiParam({ name: 'campaignId' })
  @ApiResponse({ status: 200, description: 'Brief for the campaign, or null if none exists.', type: SmartPlanBriefResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Get('brief/by-campaign/:campaignId')
  @Roles('BRAND', 'AGENCY')
  getBriefByCampaign(@Param('campaignId') campaignId: string) {
    return this.smartPlanService.getBriefByCampaign(campaignId);
  }

  /**
   * Delete the current brief: the user's standalone brief, or — when campaignId is
   * given — the brief(s) attached to that campaign. Used by the brief workspace's
   * "Delete Brief" action.
   */
  @ApiOperation({ summary: 'Delete a brief', description: 'Role: BRAND, AGENCY. Deletes the caller\'s standalone brief, or (when campaignId is given) the brief(s) attached to that campaign.' })
  @ApiQuery({ name: 'campaignId', required: false })
  @ApiResponse({ status: 200, description: 'Brief deleted.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Delete('brief')
  @Roles('BRAND', 'AGENCY')
  deleteBrief(@Request() req: any, @Query('campaignId') campaignId?: string) {
    return this.smartPlanService.deleteBrief(req.user.userId, campaignId);
  }
}
