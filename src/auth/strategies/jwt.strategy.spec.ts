import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate (soft-delete choke point)', () => {
  const makeStrategy = (findUnique: jest.Mock) =>
    new JwtStrategy({ user: { findUnique } } as any);

  it('rejects a token whose user is soft-deleted', async () => {
    const strategy = makeStrategy(jest.fn().mockResolvedValue({ isDeleted: true }));
    await expect(strategy.validate({ sub: 'u1', email: 'a@b.com' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose user no longer exists', async () => {
    const strategy = makeStrategy(jest.fn().mockResolvedValue(null));
    await expect(strategy.validate({ sub: 'u1', email: 'a@b.com' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts an active user and preserves the { userId, email } contract', async () => {
    const strategy = makeStrategy(jest.fn().mockResolvedValue({ isDeleted: false }));
    await expect(strategy.validate({ sub: 'u1', email: 'a@b.com' })).resolves.toEqual({
      userId: 'u1',
      email: 'a@b.com',
    });
  });
});
