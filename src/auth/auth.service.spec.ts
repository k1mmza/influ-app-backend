import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), findFirst: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), signAsync: jest.fn().mockResolvedValue('tok') },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('rejects a soft-deleted account with generic Invalid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        password: 'hash',
        isDeleted: true,
      });

      await expect(
        service.login({ email: 'a@b.com', password: 'pw' } as any),
      ).rejects.toThrow(UnauthorizedException);
      // deleted check must short-circuit before password comparison
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('allows an active account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        role: 'BRAND',
        isRoleSelected: true,
        password: 'hash',
        isDeleted: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const res = await service.login({ email: 'a@b.com', password: 'pw' } as any);
      expect(res.access_token).toBe('tok');
    });
  });

  describe('findOrCreateOAuthUser', () => {
    it('rejects a soft-deleted account found by oauthId', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', isDeleted: true });

      await expect(
        service.findOrCreateOAuthUser({
          oauthProvider: 'google',
          oauthId: 'gid',
          email: 'a@b.com',
          name: 'A',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
