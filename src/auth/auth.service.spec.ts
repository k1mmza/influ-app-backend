import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

const sha256 = (raw: string) =>
  crypto.createHash('sha256').update(raw).digest('hex');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; findFirst: jest.Mock };
    session: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findFirst: jest.fn() },
      session: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'new-sess' }),
        update: jest.fn().mockResolvedValue({ id: 'old-sess' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // Pass-through: the array elements are already-resolved mock promises.
      $transaction: jest.fn().mockImplementation((ops) => Promise.resolve(ops)),
    };

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

    it('allows an active account and issues both tokens', async () => {
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
      expect(typeof res.refresh_token).toBe('string');
      expect(res.refresh_token.length).toBeGreaterThan(0);
      // A session row is created storing the HASH, never the raw token.
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
      const created = prisma.session.create.mock.calls[0][0].data;
      expect(created.refreshTokenHash).toBe(sha256(res.refresh_token));
      expect(created.refreshTokenHash).not.toBe(res.refresh_token);
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

  describe('refresh', () => {
    const activeSession = () => ({
      id: 'sess1',
      userId: 'u1',
      refreshTokenHash: sha256('raw-refresh'),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u1', email: 'a@b.com', isDeleted: false },
    });

    it('issues a new access token + rotated refresh token for a valid token', async () => {
      prisma.session.findUnique.mockResolvedValue(activeSession());

      const res = await service.refresh('raw-refresh');

      expect(res.access_token).toBe('tok');
      expect(typeof res.refresh_token).toBe('string');
      // The rotated token must differ from the presented one.
      expect(res.refresh_token).not.toBe('raw-refresh');
    });

    it('rotation revokes the presented session and stores a NEW hash', async () => {
      prisma.session.findUnique.mockResolvedValue(activeSession());

      const res = await service.refresh('raw-refresh');

      // Old session revoked...
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: { revokedAt: expect.any(Date) },
      });
      // ...and a fresh session created with the hash of the NEW token only.
      const created = prisma.session.create.mock.calls[0][0].data;
      expect(created.refreshTokenHash).toBe(sha256(res.refresh_token));
      expect(created.refreshTokenHash).not.toBe(sha256('raw-refresh'));
    });

    it('rejects an expired refresh token', async () => {
      prisma.session.findUnique.mockResolvedValue({
        ...activeSession(),
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(service.refresh('raw-refresh')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects a revoked refresh token', async () => {
      prisma.session.findUnique.mockResolvedValue({
        ...activeSession(),
        revokedAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh('raw-refresh')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown refresh token', async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(service.refresh('nope')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects (and revokes) when the user was soft-deleted', async () => {
      prisma.session.findUnique.mockResolvedValue({
        ...activeSession(),
        user: { id: 'u1', email: 'a@b.com', isDeleted: true },
      });

      await expect(service.refresh('raw-refresh')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('logout', () => {
    it('revokes only the session matching the presented token', async () => {
      await service.logout('raw-refresh');

      expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
      const arg = prisma.session.updateMany.mock.calls[0][0];
      // Scoped to this token's hash (+ not-yet-revoked) — never by userId, so
      // it can't take down the user's other sessions.
      expect(arg.where).toEqual({
        refreshTokenHash: sha256('raw-refresh'),
        revokedAt: null,
      });
      expect(arg.where.userId).toBeUndefined();
      expect(arg.data).toEqual({ revokedAt: expect.any(Date) });
    });

    it('is idempotent (no throw) for an unknown token', async () => {
      prisma.session.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.logout('unknown')).resolves.toEqual({
        success: true,
      });
    });
  });
});
