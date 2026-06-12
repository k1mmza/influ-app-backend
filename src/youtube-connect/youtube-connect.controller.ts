import {
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Request,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { YouTubeConnectService } from './youtube-connect.service';

@Controller('auth/youtube')
export class YouTubeConnectController {
  constructor(private readonly service: YouTubeConnectService) {}

  /** Authenticated influencer requests the OAuth URL */
  @Post('connect')
  @UseGuards(JwtAuthGuard)
  getConnectUrl(@Request() req: any) {
    const authUrl = this.service.getAuthUrl(req.user.userId);
    return { authUrl };
  }

  /** Google redirects here after the influencer authorizes */
  @Get('connect/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (error) {
      return res.redirect(`${frontendUrl}/profile?youtube=error&reason=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return res.redirect(`${frontendUrl}/profile?youtube=error&reason=missing_params`);
    }

    try {
      await this.service.handleCallback(code, state);
      return res.redirect(`${frontendUrl}/profile?youtube=connected`);
    } catch (err: any) {
      const reason = encodeURIComponent(err.message ?? 'unknown');
      return res.redirect(`${frontendUrl}/profile?youtube=error&reason=${reason}`);
    }
  }

  /** Unlink YouTube account */
  @Delete('connect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@Request() req: any) {
    const user = await req.user;
    // Clear tokens from the platform account
    await this.service['prisma'].platformAccount.updateMany({
      where: {
        influencer: { userId: req.user.userId },
        platform: 'youtube',
      },
      data: {
        accessToken: null,
        refreshToken: null,
        tokenExpiry: null,
      },
    });
    return { message: 'YouTube account disconnected' };
  }
}
