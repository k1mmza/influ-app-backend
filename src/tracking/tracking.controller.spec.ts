import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AUTH_PASS, AUTH_FAIL, initApp, TEST_USER_ID } from '../test-utils';

const svc = {
  getSummary: jest.fn(),
  getDetail: jest.fn(),
  recordResult: jest.fn(),
};

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [TrackingController],
    providers: [{ provide: TrackingService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard).useValue(jwtMock)
    .compile();
  return initApp(module);
}

describe('TrackingController', () => {
  let app: any;

  beforeAll(async () => { app = await buildApp(AUTH_PASS); });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /tracking', () => {
    it('200 returns tracking summary for user', async () => {
      svc.getSummary.mockResolvedValueOnce({ totalCampaigns: 3, totalResults: 10 });
      const res = await request(app.getHttpServer()).get('/tracking').expect(200);
      expect(res.body.totalCampaigns).toBe(3);
      expect(svc.getSummary).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL);
      await request(noAuthApp.getHttpServer()).get('/tracking').expect(401);
      await noAuthApp.close();
    });
  });

  describe('GET /tracking/:campaignId', () => {
    it('200 returns tracking detail for campaign', async () => {
      svc.getDetail.mockResolvedValueOnce({ campaignId: 'camp-1', results: [] });
      const res = await request(app.getHttpServer()).get('/tracking/camp-1').expect(200);
      expect(res.body.campaignId).toBe('camp-1');
      expect(svc.getDetail).toHaveBeenCalledWith(TEST_USER_ID, 'camp-1');
    });

    it('404 when campaign not found', async () => {
      svc.getDetail.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer()).get('/tracking/nonexistent').expect(404);
    });
  });

  describe('POST /tracking/:campaignId/results', () => {
    it('201 records result with required submittedContentId', async () => {
      svc.recordResult.mockResolvedValueOnce({ id: 'result-1' });
      await request(app.getHttpServer())
        .post('/tracking/camp-1/results')
        .send({ submittedContentId: 'content-1', views: 1000, likes: 50 })
        .expect(201);
      expect(svc.recordResult).toHaveBeenCalledWith(
        TEST_USER_ID,
        'camp-1',
        expect.objectContaining({ submittedContentId: 'content-1' }),
      );
    });

    it('400 on missing submittedContentId', async () => {
      await request(app.getHttpServer())
        .post('/tracking/camp-1/results')
        .send({ views: 1000 })
        .expect(400);
    });

    it('400 on negative views (Min(0) violated)', async () => {
      await request(app.getHttpServer())
        .post('/tracking/camp-1/results')
        .send({ submittedContentId: 'content-1', views: -1 })
        .expect(400);
    });

    it('400 on non-integer views', async () => {
      await request(app.getHttpServer())
        .post('/tracking/camp-1/results')
        .send({ submittedContentId: 'content-1', views: 1.5 })
        .expect(400);
    });
  });
});
