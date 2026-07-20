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
  syncYoutubeStats: jest.fn(),
  getReport: jest.fn(),
  createShareLink: jest.fn(),
  listShareLinks: jest.fn(),
  revokeShareLink: jest.fn(),
};

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [TrackingController],
    providers: [{ provide: TrackingService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .compile();
  return initApp(module);
}

describe('TrackingController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /tracking', () => {
    it('200 returns tracking summary for user', async () => {
      svc.getSummary.mockResolvedValueOnce({
        totalCampaigns: 3,
        totalResults: 10,
      });
      const res = await request(app.getHttpServer())
        .get('/tracking')
        .expect(200);
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
      svc.getDetail.mockResolvedValueOnce({
        campaignId: 'camp-1',
        results: [],
      });
      const res = await request(app.getHttpServer())
        .get('/tracking/camp-1')
        .expect(200);
      expect(res.body.campaignId).toBe('camp-1');
      expect(svc.getDetail).toHaveBeenCalledWith(TEST_USER_ID, 'camp-1');
    });

    it('404 when campaign not found', async () => {
      svc.getDetail.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .get('/tracking/nonexistent')
        .expect(404);
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

  describe('GET /tracking/:campaignId/report', () => {
    it('200 returns the client-facing tracking report', async () => {
      svc.getReport.mockResolvedValueOnce({
        campaign: { id: 'camp-1' },
        progress: { totalDeliverables: 5, published: 2, remaining: 3, pctComplete: 40 },
        summary: { totalViews: 1000, avgEngagementRate: 0.05, publishedPosts: 2 },
        lastUpdated: '2026-01-01T00:00:00.000Z',
        content: [],
      });
      const res = await request(app.getHttpServer())
        .get('/tracking/camp-1/report')
        .expect(200);
      expect(res.body.campaign.id).toBe('camp-1');
      expect(svc.getReport).toHaveBeenCalledWith(TEST_USER_ID, 'camp-1');
    });

    it('404 when campaign not found or not owned', async () => {
      svc.getReport.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .get('/tracking/nonexistent/report')
        .expect(404);
    });
  });

  describe('POST /tracking/:campaignId/share', () => {
    it('201 creates a share link', async () => {
      svc.createShareLink.mockResolvedValueOnce({
        id: 'link-1',
        token: 'tok-1',
        expiresAt: null,
        lastViewedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const res = await request(app.getHttpServer())
        .post('/tracking/camp-1/share')
        .expect(201);
      expect(res.body.token).toBe('tok-1');
      expect(svc.createShareLink).toHaveBeenCalledWith(TEST_USER_ID, 'camp-1');
    });

    it('404 when campaign not found', async () => {
      svc.createShareLink.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .post('/tracking/nonexistent/share')
        .expect(404);
    });
  });

  describe('GET /tracking/:campaignId/share', () => {
    it('200 lists active share links', async () => {
      svc.listShareLinks.mockResolvedValueOnce([
        { id: 'link-1', token: 'tok-1', expiresAt: null, lastViewedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
      ]);
      const res = await request(app.getHttpServer())
        .get('/tracking/camp-1/share')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(svc.listShareLinks).toHaveBeenCalledWith(TEST_USER_ID, 'camp-1');
    });

    it('404 when campaign not found', async () => {
      svc.listShareLinks.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .get('/tracking/nonexistent/share')
        .expect(404);
    });
  });

  describe('DELETE /tracking/share/:linkId', () => {
    it('200 revokes a share link', async () => {
      svc.revokeShareLink.mockResolvedValueOnce({ revoked: true });
      const res = await request(app.getHttpServer())
        .delete('/tracking/share/link-1')
        .expect(200);
      expect(res.body).toEqual({ revoked: true });
      expect(svc.revokeShareLink).toHaveBeenCalledWith(TEST_USER_ID, 'link-1');
    });

    it('404 when share link not found', async () => {
      svc.revokeShareLink.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .delete('/tracking/share/nonexistent')
        .expect(404);
    });
  });

  // Temporary ops trigger — gated by the ADMIN_EMAILS env allowlist (no ADMIN
  // role exists). AUTH_PASS injects email 'test@example.com'.
  describe('POST /tracking/sync/youtube', () => {
    afterEach(() => {
      delete process.env.ADMIN_EMAILS;
    });

    it('201 runs the sync when the caller is on the allowlist', async () => {
      process.env.ADMIN_EMAILS = 'someone@x.com, test@example.com';
      svc.syncYoutubeStats.mockResolvedValueOnce({ written: 2, skipped: 1 });
      const res = await request(app.getHttpServer())
        .post('/tracking/sync/youtube')
        .expect(201);
      expect(res.body).toEqual({ written: 2, skipped: 1 });
      expect(svc.syncYoutubeStats).toHaveBeenCalledTimes(1);
    });

    it('403 when the caller is not on the allowlist', async () => {
      process.env.ADMIN_EMAILS = 'someone-else@x.com';
      await request(app.getHttpServer())
        .post('/tracking/sync/youtube')
        .expect(403);
      expect(svc.syncYoutubeStats).not.toHaveBeenCalled();
    });

    it('403 (deny-all) when ADMIN_EMAILS is unset', async () => {
      await request(app.getHttpServer())
        .post('/tracking/sync/youtube')
        .expect(403);
      expect(svc.syncYoutubeStats).not.toHaveBeenCalled();
    });
  });
});
