import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      // AuthService depends on PrismaService + JwtService — provide mocks so the
      // module compiles without a real DB or signing key.
      providers: [
        AuthService,
        { provide: PrismaService, useValue: {} },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), signAsync: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
