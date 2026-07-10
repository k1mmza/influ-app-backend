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
import { ProfileService } from './profile.service';
import { MediaKitImportService } from './media-kit-import.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private profileService: ProfileService,
    private mediaKitImportService: MediaKitImportService,
  ) {}

  @Get()
  getProfile(@Request() req: any) {
    return this.profileService.getProfile(req.user.userId);
  }

  @Get('completeness')
  getCompleteness(@Request() req: any) {
    return this.profileService.getCompleteness(req.user.userId);
  }

  @Patch()
  updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.userId, dto);
  }

  /**
   * Analyze an uploaded media kit (JSON or text PDF) and return PROPOSED
   * self-reported fields for review. Saves NOTHING — the influencer confirms,
   * then the existing PATCH /profile performs the only write.
   */
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

  @Delete('rate-card')
  @HttpCode(HttpStatus.OK)
  deleteRateCard(@Request() req: any) {
    return this.profileService.deleteRateCardFile(req.user.userId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  deleteProfile(@Request() req: any) {
    return this.profileService.deleteProfile(req.user.userId);
  }
}
