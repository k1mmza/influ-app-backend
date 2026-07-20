import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SelectRoleDto } from './dto/select-role.dto';
import { EmailService } from '../email/email.service';

interface OAuthUserPayload {
  oauthProvider: string;
  oauthId: string;
  email: string;
  name: string;
}

/** Optional request metadata stored on a Session for a future "manage sessions" UI. */
export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

// Access tokens are short-lived; the refresh token (+ rotation) is what keeps a
// stored account signed in for days. See POST /auth/refresh.
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;
// Password-reset links are short-lived; the frontend copy states 30 minutes.
const RESET_TOKEN_TTL_MINUTES = 30;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private email: EmailService,
  ) {}

  async register(dto: RegisterDto, meta?: SessionMeta) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        wallet: {
          create: {}, // Initialize wallet on registration
        },
      },
    });

    const tokens = await this.issueTokens(user.id, user.email, meta);
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isRoleSelected: user.isRoleSelected,
      },
    };
  }

  async findOrCreateOAuthUser(payload: OAuthUserPayload) {
    const { oauthProvider, oauthId, email, name } = payload;

    // Try to find by oauthId first, then by email (merge accounts)
    let user = await this.prisma.user.findFirst({
      where: { oauthProvider, oauthId },
    });

    if (!user && email) {
      user = await this.prisma.user.findUnique({ where: { email } });
      if (user) {
        // Link OAuth to existing email account
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { oauthProvider, oauthId },
        });
      }
    }

    if (user?.isDeleted) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          name,
          oauthProvider,
          oauthId,
          wallet: { create: {} },
        },
      });
    }

    return user;
  }

  async login(dto: LoginDto, meta?: SessionMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || user.isDeleted) {
      // Same message for deleted accounts so we don't reveal the account exists.
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      throw new UnauthorizedException(
        'This account uses Google sign-in. Please continue with Google.',
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id, user.email, meta);
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isRoleSelected: user.isRoleSelected,
      },
    };
  }

  async selectRole(userId: string, dto: SelectRoleDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: true,
        agencyProfile: true,
        influencerProfile: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.isRoleSelected) {
      throw new ConflictException('Role already selected');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Update the user role
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          role: dto.role,
          isRoleSelected: true,
        },
      });

      // 2. Create the empty profile record based on role
      if (dto.role === 'BRAND') {
        await tx.brandProfile.create({ data: { userId } });
      } else if (dto.role === 'AGENCY') {
        await tx.agencyProfile.create({ data: { userId } });
      } else if (dto.role === 'INFLUENCER') {
        await tx.influencerProfile.create({ data: { userId } });
      }

      return updatedUser;
    });
  }

  /**
   * Issue a fresh access + refresh token pair for an already-authenticated user
   * (used by the Google OAuth callback). Returns both tokens; the raw refresh
   * token is returned to the caller exactly once and only its hash is stored.
   */
  async issueTokensForUser(
    user: { id: string; email: string },
    meta?: SessionMeta,
  ) {
    return this.issueTokens(user.id, user.email, meta);
  }

  /**
   * Exchange a refresh token for a new access token AND a new refresh token.
   * Rotation: the presented session is revoked and a brand-new one is created,
   * so a refresh token can be used at most once. A revoked/expired/unknown token
   * (or a soft-deleted user) is rejected with 401.
   */
  async refresh(rawRefreshToken: string, meta?: SessionMeta) {
    const refreshTokenHash = this.hashRefreshToken(rawRefreshToken);

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash },
      include: { user: { select: { id: true, email: true, isDeleted: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!session.user || session.user.isDeleted) {
      // User gone/soft-deleted after the token was issued — kill the session too.
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Account no longer active');
    }

    // Rotate: revoke the presented session and mint a new pair atomically.
    const rawRefresh = this.generateRawRefreshToken();
    const expiresAt = this.refreshExpiry();
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.create({
        data: {
          userId: session.userId,
          refreshTokenHash: this.hashRefreshToken(rawRefresh),
          expiresAt,
          userAgent: meta?.userAgent,
          ip: meta?.ip,
        },
      }),
    ]);

    const access_token = await this.signAccessToken(
      session.user.id,
      session.user.email,
    );
    return { access_token, refresh_token: rawRefresh };
  }

  /**
   * Revoke the single session identified by this refresh token. Idempotent: an
   * unknown/already-revoked token is a no-op (still returns success) so a
   * client can always "sign out" without leaking whether the token was valid.
   */
  async logout(rawRefreshToken: string) {
    const refreshTokenHash = this.hashRefreshToken(rawRefreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  // ─── Password reset ───────────────────────────────────────────────────────────

  /**
   * Begin a password reset. ALWAYS returns the same generic response, whether or
   * not the email maps to an account — no account-enumeration leak. A reset email
   * is sent only for an active, password-based account. OAuth-only accounts
   * (password === null) and soft-deleted accounts get the generic response with
   * NO email sent: reset does not silently grant a password to a Google-only
   * account (that would be a separate, deliberate feature).
   */
  async forgotPassword(email: string) {
    const generic = { success: true };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted || !user.password) {
      return generic;
    }

    // Invalidate any outstanding tokens for this user so only the latest link
    // works. Then mint a fresh single-use token; only its hash is persisted.
    const rawToken = this.generateRawResetToken();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashResetToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
        },
      }),
    ]);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;
    await this.email.sendPasswordResetEmail(user.email, resetLink, user.name);

    return generic;
  }

  /**
   * Complete a password reset. The action only ever targets the userId stored on
   * the valid token row — a user id is never accepted from the client. A token is
   * usable exactly once: rejected if unknown, expired, already used, or if its
   * user was soft-deleted. On success the password is re-hashed, the token is
   * marked used, and ALL of the user's active sessions are revoked.
   */
  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = this.hashResetToken(rawToken);

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, isDeleted: true } } },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt <= new Date() ||
      !record.user ||
      record.user.isDeleted
    ) {
      // Single generic message — don't distinguish expired/used/unknown.
      throw new BadRequestException(
        'This password reset link is invalid or has expired.',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Force re-login everywhere after a password change.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  // ─── Token helpers ──────────────────────────────────────────────────────────

  private async issueTokens(userId: string, email: string, meta?: SessionMeta) {
    const access_token = await this.signAccessToken(userId, email);
    const rawRefresh = this.generateRawRefreshToken();
    await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: this.hashRefreshToken(rawRefresh),
        expiresAt: this.refreshExpiry(),
        userAgent: meta?.userAgent,
        ip: meta?.ip,
      },
    });
    return { access_token, refresh_token: rawRefresh };
  }

  private async signAccessToken(userId: string, email: string) {
    const payload = { sub: userId, email };
    return this.jwtService.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL });
  }

  private generateRawRefreshToken() {
    // High-entropy opaque token — this raw value is returned to the client once
    // and never persisted or logged; only its hash lives in the DB.
    return crypto.randomBytes(48).toString('hex');
  }

  private hashRefreshToken(raw: string) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private generateRawResetToken() {
    // High-entropy opaque token — returned to the user only inside the emailed
    // link and never persisted or logged; only its SHA-256 hash lives in the DB.
    return crypto.randomBytes(32).toString('hex');
  }

  private hashResetToken(raw: string) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private refreshExpiry() {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}
