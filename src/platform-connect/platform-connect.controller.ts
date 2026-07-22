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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformConnectService } from './platform-connect.service';

@ApiTags('Platform Connect')
@Controller('auth/platform')
export class PlatformConnectController {
  constructor(private readonly service: PlatformConnectService) {}

  /** Authenticated influencer requests the OAuth URL for a given platform */
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get OAuth connect URL', description: 'Authenticated influencer requests the OAuth authorization URL for a given platform (tiktok, instagram, youtube).' })
  @ApiBody({ schema: { type: 'object', properties: { platform: { type: 'string', example: 'tiktok' } }, required: ['platform'] } })
  @ApiResponse({ status: 201, description: 'Returns the OAuth authorization URL to redirect the user to.' })
  @ApiResponse({ status: 400, description: 'platform is required.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Post('connect')
  @UseGuards(JwtAuthGuard)
  getConnectUrl(@Request() req: any, @Body('platform') platform: string) {
    if (!platform) throw new BadRequestException('platform is required');
    const authUrl = this.service.getAuthUrl(req.user.userId, platform);
    return { authUrl };
  }

  /** OAuth provider redirects here after the influencer authorizes */
  @ApiOperation({
    summary: 'OAuth provider callback',
    description:
      'Public — no authentication required. OAuth redirect target reached via the platform provider, not a JSON API caller; responds with an HTML page whose script redirects the browser back to the frontend profile page with a success/error query param.',
  })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  @ApiResponse({ status: 200, description: 'HTML redirect page (not JSON).' })
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
      const decoded = JSON.parse(
        Buffer.from(state.split('.')[1], 'base64').toString(),
      );
      platform = decoded.platform ?? 'platform';
    } catch {
      // leave as default
    }

    const redirect = (url: string) => {
      res.setHeader('Content-Type', 'text/html');
      res.send(
        `<html><body><script>window.location.replace(${JSON.stringify(url)})</script></body></html>`,
      );
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

  /** Manually sync the authenticated user's own connected platform accounts */
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Manually sync my connected platform accounts',
    description:
      "On-demand sync of the authenticated influencer's connected accounts, bypassing the TTL schedule. Returns how many were synced.",
  })
  @ApiResponse({ status: 201, description: 'Sync run complete; returns { synced, total }.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Post('sync')
  @UseGuards(JwtAuthGuard)
  async syncMine(@Request() req: any) {
    return this.service.syncMyAccounts(req.user.userId);
  }

  /** Unlink a platform account (clears tokens, keeps historical data) */
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Disconnect a platform account', description: 'Clears stored OAuth tokens for the given platform; historical synced data is kept.' })
  @ApiBody({ schema: { type: 'object', properties: { platform: { type: 'string', example: 'tiktok' } }, required: ['platform'] } })
  @ApiResponse({ status: 200, description: 'Platform disconnected.' })
  @ApiResponse({ status: 400, description: 'platform is required.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Delete('connect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@Request() req: any, @Body('platform') platform: string) {
    if (!platform) throw new BadRequestException('platform is required');
    await this.service.disconnectPlatform(req.user.userId, platform);
    return { message: `${platform} account disconnected` };
  }
}
