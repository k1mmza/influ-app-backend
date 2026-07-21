import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AUTH_PASS, AUTH_FAIL, initApp, TEST_USER_ID } from '../test-utils';

const svc = {
  register: jest.fn(),
  login: jest.fn(),
  selectRole: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
};

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [{ provide: AuthService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    // Throttling isn't the unit under test here; pass it through so we don't
    // need ThrottlerModule's storage/options wired into the test module.
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  return initApp(module);
}

describe('AuthController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('POST /auth/register', () => {
    it('201 on valid body', async () => {
      svc.register.mockResolvedValueOnce({
        access_token: 'tok',
        user: { id: '1' },
      });
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'a@a.com', password: 'password123', name: 'Test User' })
        .expect(201);
      expect(svc.register).toHaveBeenCalledWith(
        { email: 'a@a.com', password: 'password123', name: 'Test User' },
        expect.any(Object), // session metadata (userAgent/ip)
      );
    });

    it('400 on missing email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ password: 'password123', name: 'Test' })
        .expect(400);
    });

    it('400 on invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'password123', name: 'Test' })
        .expect(400);
    });

    it('400 on password shorter than 6 chars', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'a@a.com', password: '123', name: 'Test' })
        .expect(400);
    });

    it('400 on missing name', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'a@a.com', password: 'password123' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('201 on valid credentials', async () => {
      svc.login.mockResolvedValueOnce({ access_token: 'tok' });
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'a@a.com', password: 'password' })
        .expect(201);
    });

    it('400 on missing password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'a@a.com' })
        .expect(400);
    });

    it('400 on invalid email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'bad', password: 'pass' })
        .expect(400);
    });
  });

  describe('POST /auth/refresh', () => {
    it('201 and returns new tokens on valid body', async () => {
      svc.refresh.mockResolvedValueOnce({
        access_token: 'a2',
        refresh_token: 'r2',
      });
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: 'r1' })
        .expect(201);
      expect(svc.refresh).toHaveBeenCalledWith('r1', expect.any(Object));
    });

    it('400 on missing refresh_token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({})
        .expect(400);
    });
  });

  describe('POST /auth/logout', () => {
    it('201 and revokes the session', async () => {
      svc.logout.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refresh_token: 'r1' })
        .expect(201);
      expect(svc.logout).toHaveBeenCalledWith('r1');
    });

    it('400 on missing refresh_token', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({})
        .expect(400);
    });
  });

  describe('POST /auth/select-role', () => {
    it('201 on valid role', async () => {
      svc.selectRole.mockResolvedValueOnce({ user: {} });
      await request(app.getHttpServer())
        .post('/auth/select-role')
        .send({ role: 'BRAND' })
        .expect(201);
      expect(svc.selectRole).toHaveBeenCalledWith(TEST_USER_ID, {
        role: 'BRAND',
      });
    });

    it('201 accepts INFLUENCER and AGENCY roles', async () => {
      svc.selectRole.mockResolvedValue({ user: {} });
      await request(app.getHttpServer())
        .post('/auth/select-role')
        .send({ role: 'INFLUENCER' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/select-role')
        .send({ role: 'AGENCY' })
        .expect(201);
    });

    it('400 on invalid role value', async () => {
      await request(app.getHttpServer())
        .post('/auth/select-role')
        .send({ role: 'SUPERUSER' })
        .expect(400);
    });

    // Privilege escalation: ADMIN is a real member of the UserRole enum, so
    // this would have passed @IsEnum(UserRole) validation and promoted the
    // caller. It must be rejected at the pipe, before reaching the service.
    it('400 on ADMIN — not self-assignable', async () => {
      await request(app.getHttpServer())
        .post('/auth/select-role')
        .send({ role: 'ADMIN' })
        .expect(400);
      expect(svc.selectRole).not.toHaveBeenCalled();
    });

    it('400 on missing role', async () => {
      await request(app.getHttpServer())
        .post('/auth/select-role')
        .send({})
        .expect(400);
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL);
      await request(noAuthApp.getHttpServer())
        .post('/auth/select-role')
        .send({ role: 'BRAND' })
        .expect(401);
      await noAuthApp.close();
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('201 and forwards the email to the service', async () => {
      svc.forgotPassword.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'a@a.com' })
        .expect(201)
        .expect({ success: true });
      expect(svc.forgotPassword).toHaveBeenCalledWith('a@a.com');
    });

    it('400 on a malformed email', async () => {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'not-an-email' })
        .expect(400);
      expect(svc.forgotPassword).not.toHaveBeenCalled();
    });

    it('400 on missing email', async () => {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({})
        .expect(400);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('201 and forwards token + password to the service', async () => {
      svc.resetPassword.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'raw-token', password: 'newPassword1' })
        .expect(201)
        .expect({ success: true });
      expect(svc.resetPassword).toHaveBeenCalledWith(
        'raw-token',
        'newPassword1',
      );
    });

    it('400 on a too-short password', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'raw-token', password: '123' })
        .expect(400);
      expect(svc.resetPassword).not.toHaveBeenCalled();
    });

    it('400 on missing token', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ password: 'newPassword1' })
        .expect(400);
    });
  });
});
