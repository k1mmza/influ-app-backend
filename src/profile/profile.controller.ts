import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private profileService: ProfileService) {}

  // GET /profile
  @Get()
  getProfile(@Request() req) {
    return this.profileService.getProfile(req.user.userId);
  }

  // GET /profile/completeness
  @Get('completeness')
  getCompleteness(@Request() req) {
    return this.profileService.getCompleteness(req.user.userId);
  }

  // PATCH /profile
  @Patch()
  updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.userId, dto);
  }

  // DELETE /profile
  @Delete()
  @HttpCode(HttpStatus.OK)
  deleteProfile(@Request() req) {
    return this.profileService.deleteProfile(req.user.userId);
  }
}
