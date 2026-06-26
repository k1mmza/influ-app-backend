import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AUTH_PASS, AUTH_FAIL, initApp, TEST_USER_ID } from '../test-utils';

const svc = { getDashboardData: jest.fn() };

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [DashboardController],
    providers: [{ provide: DashboardService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .compile();
  return initApp(module);
}

describe('DashboardController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /dashboard', () => {
    it('200 returns dashboard data for user', async () => {
      svc.getDashboardData.mockResolvedValueOnce({
        campaigns: 3,
        influencers: 10,
      });
      const res = await request(app.getHttpServer())
        .get('/dashboard')
        .expect(200);
      expect(res.body).toEqual({ campaigns: 3, influencers: 10 });
      expect(svc.getDashboardData).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL);
      await request(noAuthApp.getHttpServer()).get('/dashboard').expect(401);
      await noAuthApp.close();
    });
  });
});
