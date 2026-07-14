import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { MediaKitImportService } from './media-kit-import.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Profile')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private profileService: ProfileService,
    private mediaKitImportService: MediaKitImportService,
  ) {}

  @ApiOperation({ summary: 'Get the authenticated user\'s profile' })
  @ApiResponse({ status: 200, description: 'Profile detail.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Get()
  getProfile(@Request() req: any) {
    return this.profileService.getProfile(req.user.userId);
  }

  @ApiOperation({ summary: 'Get profile completeness score' })
  @ApiResponse({ status: 200, description: 'Completeness percentage and missing-field breakdown.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Get('completeness')
  getCompleteness(@Request() req: any) {
    return this.profileService.getCompleteness(req.user.userId);
  }

  @ApiOperation({ summary: 'Update the authenticated user\'s profile' })
  @ApiResponse({ status: 200, description: 'Profile updated.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Patch()
  updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.userId, dto);
  }

  /**
   * Analyze an uploaded media kit (JSON or text PDF) and return PROPOSED
   * self-reported fields for review. Saves NOTHING — the influencer confirms,
   * then the existing PATCH /profile performs the only write.
   */
  @ApiOperation({
    summary: 'AI-assisted media kit analysis',
    description:
      'AI-assisted: extracts proposed profile fields from an uploaded media kit for the influencer to review. Saves nothing — confirming the suggestions is a separate PATCH /profile call. Role: INFLUENCER. Max 10MB. Accepts JSON, plain text, PDF, or image (jpeg/png/webp).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'Proposed profile fields extracted from the media kit.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @Post('media-kit/analyze')
  @UseGuards(RolesGuard)
  @Roles('INFLUENCER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = [
          'application/json',
          'text/json',
          'text/plain',
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
        ];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  analyzeMediaKit(@UploadedFile() file: Express.Multer.File) {
    return this.mediaKitImportService.analyzeFile(file);
  }

  @ApiOperation({ summary: 'Upload avatar image', description: 'Max 5MB. Accepts image/jpeg, image/png, image/webp, image/gif.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'Avatar uploaded; returns the new avatarUrl.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Post('avatar')
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
  uploadAvatar(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.profileService.uploadAvatarFile(req.user.userId, file);
  }

  @ApiOperation({ summary: 'Upload rate card file', description: 'Max 10MB. Accepts application/pdf, image/jpeg, image/png, image/webp.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'Rate card uploaded; returns the new rateCardFileUrl.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Post('rate-card')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
        ];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  uploadRateCard(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.profileService.uploadRateCardFile(req.user.userId, file);
  }

  @ApiOperation({ summary: 'Delete the uploaded rate card file' })
  @ApiResponse({ status: 200, description: 'Rate card removed.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Delete('rate-card')
  @HttpCode(HttpStatus.OK)
  deleteRateCard(@Request() req: any) {
    return this.profileService.deleteRateCardFile(req.user.userId);
  }

  @ApiOperation({ summary: 'Delete the authenticated user\'s account', description: 'Soft delete (isDeleted flag).' })
  @ApiResponse({ status: 200, description: 'Account deleted.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Delete()
  @HttpCode(HttpStatus.OK)
  deleteProfile(@Request() req: any) {
    return this.profileService.deleteProfile(req.user.userId);
  }
}
