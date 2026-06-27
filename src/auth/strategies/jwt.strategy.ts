import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'super-secret-key-change-me-later',
    });
  }

  async validate(payload: any) {
    // Choke point for every authenticated request: reject tokens whose user has
    // been soft-deleted, so a still-valid token (1d expiry) can't outlive the account.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isDeleted: true },
    });
    if (!user || user.isDeleted) {
      throw new UnauthorizedException('Account no longer active');
    }
    return { userId: payload.sub, email: payload.email };
  }
}
