import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SelectRoleDto } from './dto/select-role.dto';

interface OAuthUserPayload {
  oauthProvider: string;
  oauthId: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
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

    const token = await this.generateToken(user.id, user.email);
    return {
      ...token,
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

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      throw new UnauthorizedException('This account uses Google sign-in. Please continue with Google.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = await this.generateToken(user.id, user.email);
    return {
      ...token,
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

  async generateTokenForUser(user: { id: string; email: string }) {
    return this.generateToken(user.id, user.email);
  }

  private async generateToken(userId: string, email: string) {
    const payload = { sub: userId, email };
    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}
