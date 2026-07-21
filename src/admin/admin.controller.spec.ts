import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  AUTH_PASS,
  AUTH_FAIL,
  ROLE_PASS,
  ROLE_FAIL,
  initApp,
} from '../test-utils';

const svc = {
  getAllCampaigns: jest.fn(),
  getDashboard: jest.fn(),
};

async function buildApp(jwtMock: object, rolesMock: object) {
  const module = await Test.createTestingModule({
    controllers: [AdminController],
    providers: [{ provide: AdminService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .overrideGuard(RolesGuard)
    .useValue(rolesMock)
    .compile();
  return initApp(module);
}

describe('AdminController', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('as an ADMIN', () => {
    let app: any;
    beforeAll(async () => {
      app = await buildApp(AUTH_PASS, ROLE_PASS);
    });
    afterAll(() => app.close());

    it('GET /admin/campaigns defaults to page 1, pageSize 20', async () => {
      svc.getAllCampaigns.mockResolvedValueOnce({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });
      await request(app.getHttpServer()).get('/admin/campaigns').expect(200);
      expect(svc.getAllCampaigns).toHaveBeenCalledWith(1, 20);
    });

    it('GET /admin/campaigns honours page + pageSize', async () => {
      svc.getAllCampaigns.mockResolvedValueOnce({
        data: [],
        total: 0,
        page: 3,
        pageSize: 5,
        totalPages: 0,
      });
      await request(app.getHttpServer())
        .get('/admin/campaigns?page=3&pageSize=5')
        .expect(200);
      expect(svc.getAllCampaigns).toHaveBeenCalledWith(3, 5);
    });

    it('GET /admin/dashboard returns aggregate counts', async () => {
      svc.getDashboard.mockResolvedValueOnce({ role: 'admin', campaigns: 7 });
      const res = await request(app.getHttpServer())
        .get('/admin/dashboard')
        .expect(200);
      expect(res.body.campaigns).toBe(7);
    });
  });

  // The privilege boundary. RolesGuard itself is covered in roles.guard.spec.ts;
  // this asserts both admin routes actually sit behind it.
  describe('as a non-ADMIN', () => {
    let app: any;
    beforeAll(async () => {
      app = await buildApp(AUTH_PASS, ROLE_FAIL);
    });
    afterAll(() => app.close());

    it('403s on /admin/campaigns without reaching the service', async () => {
      await request(app.getHttpServer()).get('/admin/campaigns').expect(403);
      expect(svc.getAllCampaigns).not.toHaveBeenCalled();
    });

    it('403s on /admin/dashboard without reaching the service', async () => {
      await request(app.getHttpServer()).get('/admin/dashboard').expect(403);
      expect(svc.getDashboard).not.toHaveBeenCalled();
    });
  });

  describe('unauthenticated', () => {
    let app: any;
    beforeAll(async () => {
      app = await buildApp(AUTH_FAIL, ROLE_PASS);
    });
    afterAll(() => app.close());

    it('401s on /admin/campaigns', async () => {
      await request(app.getHttpServer()).get('/admin/campaigns').expect(401);
      expect(svc.getAllCampaigns).not.toHaveBeenCalled();
    });
  });
});
