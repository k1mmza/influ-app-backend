import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AUTH_PASS, AUTH_FAIL, initApp, TEST_USER_ID } from '../test-utils';

const svc = {
  register: jest.fn(),
  login: jest.fn(),
  selectRole: jest.fn(),
};

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [{ provide: AuthService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard).useValue(jwtMock)
    .compile();
  return initApp(module);
}

describe('AuthController', () => {
  let app: any;

  beforeAll(async () => { app = await buildApp(AUTH_PASS); });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('POST /auth/register', () => {
    it('201 on valid body', async () => {
      svc.register.mockResolvedValueOnce({ access_token: 'tok', user: { id: '1' } });
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'a@a.com', password: 'password123', name: 'Test User' })
        .expect(201);
      expect(svc.register).toHaveBeenCalledWith({ email: 'a@a.com', password: 'password123', name: 'Test User' });
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

  describe('POST /auth/select-role', () => {
    it('201 on valid role', async () => {
      svc.selectRole.mockResolvedValueOnce({ user: {} });
      await request(app.getHttpServer())
        .post('/auth/select-role')
        .send({ role: 'BRAND' })
        .expect(201);
      expect(svc.selectRole).toHaveBeenCalledWith(TEST_USER_ID, { role: 'BRAND' });
    });

    it('201 accepts INFLUENCER and AGENCY roles', async () => {
      svc.selectRole.mockResolvedValue({ user: {} });
      await request(app.getHttpServer()).post('/auth/select-role').send({ role: 'INFLUENCER' }).expect(201);
      await request(app.getHttpServer()).post('/auth/select-role').send({ role: 'AGENCY' }).expect(201);
    });

    it('400 on invalid role value', async () => {
      await request(app.getHttpServer())
        .post('/auth/select-role')
        .send({ role: 'SUPERUSER' })
        .expect(400);
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
});
