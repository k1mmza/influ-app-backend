import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ShortlistController } from './shortlist.controller';
import { ShortlistService } from './shortlist.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  AUTH_PASS,
  AUTH_FAIL,
  ROLE_PASS,
  ROLE_FAIL,
  initApp,
  TEST_USER_ID,
} from '../test-utils';

const svc = {
  getShortlist: jest.fn(),
  add: jest.fn(),
  remove: jest.fn(),
};

async function buildApp(jwtMock: object, rolesMock: object) {
  const module = await Test.createTestingModule({
    controllers: [ShortlistController],
    providers: [{ provide: ShortlistService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .overrideGuard(RolesGuard)
    .useValue(rolesMock)
    .compile();
  return initApp(module);
}

describe('ShortlistController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS, ROLE_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /shortlist', () => {
    it('200 returns shortlisted influencers', async () => {
      svc.getShortlist.mockResolvedValueOnce([{ influencerId: 'inf-1' }]);
      const res = await request(app.getHttpServer())
        .get('/shortlist')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(svc.getShortlist).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('200 returns empty list when shortlist is empty', async () => {
      svc.getShortlist.mockResolvedValueOnce([]);
      const res = await request(app.getHttpServer())
        .get('/shortlist')
        .expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /shortlist/:influencerId', () => {
    it('201 adds influencer to shortlist', async () => {
      svc.add.mockResolvedValueOnce({ influencerId: 'inf-1' });
      await request(app.getHttpServer()).post('/shortlist/inf-1').expect(201);
      expect(svc.add).toHaveBeenCalledWith(TEST_USER_ID, 'inf-1');
    });
  });

  describe('DELETE /shortlist/:influencerId', () => {
    it('200 removes influencer from shortlist', async () => {
      svc.remove.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer()).delete('/shortlist/inf-1').expect(200);
      expect(svc.remove).toHaveBeenCalledWith(TEST_USER_ID, 'inf-1');
    });
  });

  describe('Auth and role failures', () => {
    it('401 GET /shortlist without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL, ROLE_PASS);
      await request(noAuthApp.getHttpServer()).get('/shortlist').expect(401);
      await noAuthApp.close();
    });

    it('403 GET /shortlist with wrong role', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer()).get('/shortlist').expect(403);
      await noRoleApp.close();
    });

    it('403 POST /shortlist/:id with wrong role', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer())
        .post('/shortlist/inf-1')
        .expect(403);
      await noRoleApp.close();
    });
  });
});
