import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SelectRoleDto } from './dto/select-role.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('select-role')
  selectRole(@Request() req, @Body() dto: SelectRoleDto) {
    return this.authService.selectRole(req.user.userId, dto);
  }

  // ─── Google OAuth ─────────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Passport redirects to Google — no body needed
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Request() req, @Res() res: Response) {
    const { access_token } = await this.authService.generateTokenForUser(
      req.user,
    );
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const isRoleSelected = req.user.isRoleSelected;
    res.redirect(
      `${frontendUrl}/auth/callback?token=${access_token}&roleSelected=${isRoleSelected}`,
    );
  }
}
