import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

const sha256 = (raw: string) =>
  crypto.createHash('sha256').update(raw).digest('hex');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    session: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    passwordResetToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let email: { sendPasswordResetEmail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
      session: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'new-sess' }),
        update: jest.fn().mockResolvedValue({ id: 'old-sess' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'prt1' }),
        update: jest.fn().mockResolvedValue({ id: 'prt1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Pass-through: the array elements are already-resolved mock promises.
      $transaction: jest.fn().mockImplementation((ops) => Promise.resolve(ops)),
    };
    email = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            signAsync: jest.fn().mockResolvedValue('tok'),
          },
        },
        { provide: EmailService, useValue: email },
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

      const res = await service.login({
        email: 'a@b.com',
        password: 'pw',
      });
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

  describe('forgotPassword', () => {
    const activeUser = {
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      password: 'existing-hash',
      isDeleted: false,
    };

    /** Pull the raw token out of the reset link handed to the email service. */
    const emailedRawToken = () => {
      const link = email.sendPasswordResetEmail.mock.calls[0][1] as string;
      return new URL(link).searchParams.get('token') as string;
    };

    it('valid, active, password-based account → generic success + emailed link; only the HASH is stored', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);

      const res = await service.forgotPassword('a@b.com');

      expect(res).toEqual({ success: true });
      // A token row is created and an email is sent.
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);

      // The persisted value is the SHA-256 hash of the raw token in the link —
      // the raw token itself is NEVER stored.
      const raw = emailedRawToken();
      const stored = prisma.passwordResetToken.create.mock.calls[0][0].data
        .tokenHash as string;
      expect(stored).toBe(sha256(raw));
      expect(stored).not.toBe(raw);
      // Prior outstanding tokens for this user are invalidated first.
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', usedAt: null },
      });
    });

    it('non-existent email → same generic success, no token, no email (no enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const res = await service.forgotPassword('nobody@b.com');

      expect(res).toEqual({ success: true });
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('OAuth-only account (password === null) → generic success, no token, no email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        password: null,
      });

      const res = await service.forgotPassword('a@b.com');

      expect(res).toEqual({ success: true });
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('soft-deleted account → generic success, no token, no email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        isDeleted: true,
      });

      const res = await service.forgotPassword('a@b.com');

      expect(res).toEqual({ success: true });
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const validRecord = () => ({
      id: 'prt1',
      userId: 'u1',
      tokenHash: sha256('raw-reset'),
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u1', isDeleted: false },
    });

    it('valid token → re-hashes password for the token owner, consumes token, revokes sessions', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validRecord());
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      const res = await service.resetPassword('raw-reset', 'newPassword1');

      expect(res).toEqual({ success: true });
      // Password updated on the token's OWN userId — never a client-supplied id.
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { password: 'new-hash' },
      });
      // Token consumed (single-use).
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'prt1' },
        data: { usedAt: expect.any(Date) },
      });
      // All active sessions revoked.
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('looks the token up by its HASH, never the raw value', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validRecord());
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      await service.resetPassword('raw-reset', 'newPassword1');

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: sha256('raw-reset') } }),
      );
    });

    it('expired token → rejected, password unchanged', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validRecord(),
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(
        service.resetPassword('raw-reset', 'newPassword1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('already-used token (second use) → rejected, password unchanged', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validRecord(),
        usedAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword('raw-reset', 'newPassword1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('unknown token → rejected, password unchanged', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('nope', 'newPassword1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('token whose user was soft-deleted → rejected, password unchanged', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validRecord(),
        user: { id: 'u1', isDeleted: true },
      });

      await expect(
        service.resetPassword('raw-reset', 'newPassword1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('selectRole', () => {
    // ADMIN exists in the UserRole enum but must never be reachable through the
    // signup flow. The DTO blocks it at the edge; this covers the service-level
    // re-check, i.e. the case where a caller reaches the service directly.
    it('rejects ADMIN even for a user who has not selected a role', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        isRoleSelected: false,
      });

      await expect(
        service.selectRole('u1', { role: UserRole.ADMIN }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([UserRole.BRAND, UserRole.AGENCY, UserRole.INFLUENCER])(
      'allows %s to be self-selected',
      async (role) => {
        prisma.user.findUnique.mockResolvedValue({
          id: 'u1',
          isRoleSelected: false,
        });
        // selectRole uses the callback form of $transaction; the shared mock is
        // an array pass-through for the other suites, so supply a tx here.
        const tx = {
          user: { update: jest.fn().mockResolvedValue({ id: 'u1', role }) },
          brandProfile: { create: jest.fn() },
          agencyProfile: { create: jest.fn() },
          influencerProfile: { create: jest.fn() },
        };
        prisma.$transaction.mockImplementation((cb: any) => cb(tx));

        await expect(service.selectRole('u1', { role })).resolves.toBeDefined();
        expect(tx.user.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ role }) }),
        );
      },
    );
  });
});
