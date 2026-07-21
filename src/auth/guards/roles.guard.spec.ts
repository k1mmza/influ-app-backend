import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * RolesGuard had no spec before ADMIN was introduced. It is now the only thing
 * standing between a BRAND user and the platform-wide admin views, so the
 * deny paths are worth pinning down explicitly.
 */
describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  const ctx = (user: any) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => null,
      getClass: () => null,
    }) as any;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };
    guard = new RolesGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
  });

  it('allows a route with no @Roles metadata', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(ctx({ userId: 'u1' }))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows an ADMIN on an ADMIN-only route', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });
    await expect(guard.canActivate(ctx({ userId: 'u1' }))).resolves.toBe(true);
  });

  it.each([UserRole.BRAND, UserRole.AGENCY, UserRole.INFLUENCER])(
    'denies %s on an ADMIN-only route',
    async (role) => {
      reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
      prisma.user.findUnique.mockResolvedValue({ role });
      await expect(guard.canActivate(ctx({ userId: 'u1' }))).resolves.toBe(
        false,
      );
    },
  );

  it('denies when there is no authenticated user', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    await expect(guard.canActivate(ctx(undefined))).resolves.toBe(false);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  // The role is read from the DB per request, not from the JWT — so a user
  // demoted after their token was issued loses access immediately.
  it('denies when the user no longer exists in the DB', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ userId: 'u1' }))).resolves.toBe(false);
  });

  it('reads the role from the DB, ignoring any role on the JWT payload', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.BRAND });
    await expect(
      guard.canActivate(ctx({ userId: 'u1', role: UserRole.ADMIN })),
    ).resolves.toBe(false);
  });
});
