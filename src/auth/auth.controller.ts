import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Req,
  Res,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService, SessionMeta } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SelectRoleDto } from './dto/select-role.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

/** Pull userAgent/ip off the request for the Session row (future "manage sessions" UI). */
function sessionMeta(req: ExpressRequest): SessionMeta {
  return {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new account', description: 'Public — no authentication required.' })
  @ApiResponse({ status: 201, description: 'Account created; returns access_token and user.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Email already exists.', type: ErrorResponseDto })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: ExpressRequest) {
    return this.authService.register(dto, sessionMeta(req));
  }

  @ApiOperation({ summary: 'Log in with email and password', description: 'Public — no authentication required.' })
  @ApiResponse({ status: 201, description: 'Login succeeded; returns access_token and user.' })
  @ApiResponse({
    status: 401,
    description:
      '"Invalid credentials" — no matching/active user, or wrong password (deliberately the same message for both, to avoid leaking account existence). "This account uses Google sign-in. Please continue with Google." — account has no password (OAuth-only).',
    type: ErrorResponseDto,
  })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: ExpressRequest) {
    return this.authService.login(dto, sessionMeta(req));
  }

  // Exchange a refresh token for a new access token + rotated refresh token.
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Req() req: ExpressRequest) {
    return this.authService.refresh(dto.refresh_token, sessionMeta(req));
  }

  // Revoke this one session server-side (real logout, not just client-side).
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refresh_token);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Select account role', description: 'One-time: sets the role (AGENCY/BRAND/INFLUENCER) for a newly created or OAuth-provisioned account.' })
  @ApiResponse({ status: 201, description: 'Role selected; role-specific profile created.' })
  @ApiResponse({ status: 401, description: 'Missing/invalid bearer token, or user not found.', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Role already selected.', type: ErrorResponseDto })
  @UseGuards(JwtAuthGuard)
  @Post('select-role')
  selectRole(@Request() req, @Body() dto: SelectRoleDto) {
    return this.authService.selectRole(req.user.userId, dto);
  }

  // ─── Google OAuth ─────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Start Google OAuth login', description: 'Public — no authentication required. Redirects the browser to Google\'s consent screen.' })
  @ApiResponse({ status: 302, description: 'Redirect to Google.' })
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Passport redirects to Google — no body needed
  }

  @ApiOperation({ summary: 'Google OAuth callback', description: 'Public — no authentication required. Reached via Google\'s redirect, not a JSON API caller. Issues a JWT and redirects to the frontend with it in the query string.' })
  @ApiResponse({ status: 302, description: 'Redirect to frontend with access token.' })
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Request() req, @Res() res: Response) {
    const { access_token, refresh_token } =
      await this.authService.issueTokensForUser(req.user, sessionMeta(req));
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const isRoleSelected = req.user.isRoleSelected;
    res.redirect(
      `${frontendUrl}/auth/callback?token=${access_token}&refresh=${refresh_token}&roleSelected=${isRoleSelected}`,
    );
  }
}
