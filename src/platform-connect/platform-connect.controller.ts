import {
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Body,
  Request,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformConnectService } from './platform-connect.service';

@Controller('auth/platform')
export class PlatformConnectController {
  constructor(private readonly service: PlatformConnectService) {}

  /** Authenticated influencer requests the OAuth URL for a given platform */
  @Post('connect')
  @UseGuards(JwtAuthGuard)
  getConnectUrl(@Request() req: any, @Body('platform') platform: string) {
    if (!platform) throw new BadRequestException('platform is required');
    const authUrl = this.service.getAuthUrl(req.user.userId, platform);
    return { authUrl };
  }

  /** OAuth provider redirects here after the influencer authorizes */
  @Get('connect/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Decode platform from state for the redirect query param
    let platform = 'platform';
    try {
      const decoded = JSON.parse(Buffer.from(state.split('.')[1], 'base64').toString());
      platform = decoded.platform ?? 'platform';
    } catch {
      // leave as default
    }

    const redirect = (url: string) => {
      res.setHeader('Content-Type', 'text/html');
      res.send(`<html><body><script>window.location.replace(${JSON.stringify(url)})</script></body></html>`);
    };

    if (error) {
      return redirect(
        `${frontendUrl}/profile?platform_connect=error&platform=${platform}&reason=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return redirect(
        `${frontendUrl}/profile?platform_connect=error&platform=${platform}&reason=missing_params`,
      );
    }

    try {
      await this.service.handleCallback(code, state);
      return redirect(
        `${frontendUrl}/profile?platform_connect=success&platform=${platform}`,
      );
    } catch (err: any) {
      const reason = encodeURIComponent(err.message ?? 'unknown');
      return redirect(
        `${frontendUrl}/profile?platform_connect=error&platform=${platform}&reason=${reason}`,
      );
    }
  }

  /** Unlink a platform account (clears tokens, keeps historical data) */
  @Delete('connect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@Request() req: any, @Body('platform') platform: string) {
    if (!platform) throw new BadRequestException('platform is required');
    await this.service.disconnectPlatform(req.user.userId, platform);
    return { message: `${platform} account disconnected` };
  }
}
