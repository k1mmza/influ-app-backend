import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AUTH_PASS, AUTH_FAIL, initApp, TEST_USER_ID } from '../test-utils';

const svc = {
  getCampaignsForUser: jest.fn(),
  createCampaign: jest.fn(),
  getPublicCampaigns: jest.fn(),
  getCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  deleteCampaign: jest.fn(),
  applyToCampaign: jest.fn(),
  getApplications: jest.fn(),
  updateApplicationStatus: jest.fn(),
  getCampaignShortlist: jest.fn(),
  addToCampaignShortlist: jest.fn(),
  updateCampaignShortlistNote: jest.fn(),
  removeFromCampaignShortlist: jest.fn(),
  createShortlistShareLink: jest.fn(),
  listShortlistShareLinks: jest.fn(),
  revokeShortlistShareLink: jest.fn(),
};

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [CampaignsController],
    providers: [{ provide: CampaignsService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .compile();
  return initApp(module);
}

describe('CampaignsController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /campaigns', () => {
    it('200 returns campaigns for the authenticated user', async () => {
      svc.getCampaignsForUser.mockResolvedValueOnce([
        { id: 'c1', name: 'Camp 1' },
      ]);
      const res = await request(app.getHttpServer())
        .get('/campaigns')
        .expect(200);
      expect(res.body).toEqual([{ id: 'c1', name: 'Camp 1' }]);
      expect(svc.getCampaignsForUser).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });

  describe('POST /campaigns', () => {
    it('201 creates campaign with required name', async () => {
      svc.createCampaign.mockResolvedValueOnce({
        id: 'c1',
        name: 'My Campaign',
      });
      const res = await request(app.getHttpServer())
        .post('/campaigns')
        .send({ name: 'My Campaign' })
        .expect(201);
      expect(res.body.name).toBe('My Campaign');
      expect(svc.createCampaign).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ name: 'My Campaign' }),
      );
    });

    it('400 on missing name', async () => {
      await request(app.getHttpServer())
        .post('/campaigns')
        .send({})
        .expect(400);
    });

    it('400 on extra unrecognised field', async () => {
      await request(app.getHttpServer())
        .post('/campaigns')
        .send({ name: 'Camp', unknownField: 'bad' })
        .expect(400);
    });
  });

  describe('GET /campaigns/public', () => {
    it('200 with default pagination (page=1, pageSize=12)', async () => {
      svc.getPublicCampaigns.mockResolvedValueOnce({ items: [], total: 0 });
      await request(app.getHttpServer()).get('/campaigns/public').expect(200);
      expect(svc.getPublicCampaigns).toHaveBeenCalledWith(1, 12);
    });

    it('200 with custom page and pageSize', async () => {
      svc.getPublicCampaigns.mockResolvedValueOnce({ items: [], total: 0 });
      await request(app.getHttpServer())
        .get('/campaigns/public?page=2&pageSize=5')
        .expect(200);
      expect(svc.getPublicCampaigns).toHaveBeenCalledWith(2, 5);
    });

    it('defaults page to 1 when not provided', async () => {
      svc.getPublicCampaigns.mockResolvedValueOnce({ items: [], total: 0 });
      await request(app.getHttpServer()).get('/campaigns/public').expect(200);
      expect(svc.getPublicCampaigns).toHaveBeenCalledWith(1, 12);
    });
  });

  describe('GET /campaigns/:id', () => {
    it('200 returns campaign by id', async () => {
      svc.getCampaign.mockResolvedValueOnce({
        id: 'c1',
        name: 'Camp',
        isDeleted: false,
      });
      const res = await request(app.getHttpServer())
        .get('/campaigns/c1')
        .expect(200);
      expect(res.body.id).toBe('c1');
    });

    it('404 when campaign not found', async () => {
      svc.getCampaign.mockRejectedValueOnce(
        new NotFoundException('Campaign not found'),
      );
      await request(app.getHttpServer())
        .get('/campaigns/nonexistent')
        .expect(404);
    });
  });

  describe('PATCH /campaigns/:id', () => {
    it('200 updates campaign fields', async () => {
      svc.updateCampaign.mockResolvedValueOnce({ id: 'c1', name: 'Updated' });
      await request(app.getHttpServer())
        .patch('/campaigns/c1')
        .send({ name: 'Updated' })
        .expect(200);
      expect(svc.updateCampaign).toHaveBeenCalledWith(
        TEST_USER_ID,
        'c1',
        expect.objectContaining({ name: 'Updated' }),
      );
    });

    it('400 on invalid status value', async () => {
      await request(app.getHttpServer())
        .patch('/campaigns/c1')
        .send({ status: 'INVALID_STATUS' })
        .expect(400);
    });

    it('200 with valid status ACTIVE', async () => {
      svc.updateCampaign.mockResolvedValueOnce({ id: 'c1', status: 'ACTIVE' });
      await request(app.getHttpServer())
        .patch('/campaigns/c1')
        .send({ status: 'ACTIVE' })
        .expect(200);
    });

    it('404 when campaign not found', async () => {
      svc.updateCampaign.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .patch('/campaigns/nonexistent')
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /campaigns/:id', () => {
    it('200 soft-deletes campaign', async () => {
      svc.deleteCampaign.mockResolvedValueOnce({ message: 'deleted' });
      await request(app.getHttpServer()).delete('/campaigns/c1').expect(200);
      expect(svc.deleteCampaign).toHaveBeenCalledWith(TEST_USER_ID, 'c1');
    });

    it('404 when campaign not found', async () => {
      svc.deleteCampaign.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .delete('/campaigns/nonexistent')
        .expect(404);
    });
  });

  describe('POST /campaigns/:id/apply', () => {
    it('201 applies to campaign', async () => {
      svc.applyToCampaign.mockResolvedValueOnce({
        id: 'app-1',
        status: 'PENDING',
      });
      await request(app.getHttpServer())
        .post('/campaigns/c1/apply')
        .expect(201);
      expect(svc.applyToCampaign).toHaveBeenCalledWith(TEST_USER_ID, 'c1');
    });

    it('404 when campaign not found', async () => {
      svc.applyToCampaign.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .post('/campaigns/nonexistent/apply')
        .expect(404);
    });
  });

  describe('GET /campaigns/:id/applications', () => {
    it('200 returns list of applications', async () => {
      svc.getApplications.mockResolvedValueOnce([
        { id: 'app-1', status: 'PENDING' },
      ]);
      const res = await request(app.getHttpServer())
        .get('/campaigns/c1/applications')
        .expect(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('PATCH /campaigns/:id/applications/:applicationId', () => {
    it('200 updates application status', async () => {
      svc.updateApplicationStatus.mockResolvedValueOnce({
        id: 'app-1',
        status: 'APPROVED',
      });
      await request(app.getHttpServer())
        .patch('/campaigns/c1/applications/app-1')
        .send({ status: 'APPROVED' })
        .expect(200);
      expect(svc.updateApplicationStatus).toHaveBeenCalledWith(
        TEST_USER_ID,
        'c1',
        'app-1',
        'APPROVED',
      );
    });
  });

  describe('Campaign shortlist', () => {
    it('200 GET /campaigns/:id/shortlist delegates with user + campaign id', async () => {
      svc.getCampaignShortlist.mockResolvedValueOnce([{ id: 'cs1' }]);
      const res = await request(app.getHttpServer())
        .get('/campaigns/c1/shortlist')
        .expect(200);
      expect(res.body).toEqual([{ id: 'cs1' }]);
      expect(svc.getCampaignShortlist).toHaveBeenCalledWith(TEST_USER_ID, 'c1');
    });

    it('201 POST /campaigns/:id/shortlist forwards the influencerId', async () => {
      svc.addToCampaignShortlist.mockResolvedValueOnce({ id: 'cs1' });
      await request(app.getHttpServer())
        .post('/campaigns/c1/shortlist')
        .send({ influencerId: 'inf-1' })
        .expect(201);
      expect(svc.addToCampaignShortlist).toHaveBeenCalledWith(
        TEST_USER_ID,
        'c1',
        { influencerId: 'inf-1' },
      );
    });

    it('400 POST /campaigns/:id/shortlist rejects a missing influencerId', async () => {
      await request(app.getHttpServer())
        .post('/campaigns/c1/shortlist')
        .send({})
        .expect(400);
      expect(svc.addToCampaignShortlist).not.toHaveBeenCalled();
    });

    it('200 PATCH /campaigns/:id/shortlist/:influencerId forwards note + price', async () => {
      svc.updateCampaignShortlistNote.mockResolvedValueOnce({ id: 'cs1' });
      await request(app.getHttpServer())
        .patch('/campaigns/c1/shortlist/inf-1')
        .send({ recommendationNote: 'Great fit', proposedPrice: 5000 })
        .expect(200);
      expect(svc.updateCampaignShortlistNote).toHaveBeenCalledWith(
        TEST_USER_ID,
        'c1',
        'inf-1',
        { recommendationNote: 'Great fit', proposedPrice: 5000 },
      );
    });

    it('200 DELETE /campaigns/:id/shortlist/:influencerId removes the entry', async () => {
      svc.removeFromCampaignShortlist.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer())
        .delete('/campaigns/c1/shortlist/inf-1')
        .expect(200);
      expect(svc.removeFromCampaignShortlist).toHaveBeenCalledWith(
        TEST_USER_ID,
        'c1',
        'inf-1',
      );
    });
  });

  describe('Influencers-preview share links', () => {
    it('201 POST /campaigns/:campaignId/shortlist-share mints a link', async () => {
      svc.createShortlistShareLink.mockResolvedValueOnce({ token: 'tok-1' });
      const res = await request(app.getHttpServer())
        .post('/campaigns/c1/shortlist-share')
        .expect(201);
      expect(res.body).toEqual({ token: 'tok-1' });
      expect(svc.createShortlistShareLink).toHaveBeenCalledWith(
        TEST_USER_ID,
        'c1',
      );
    });

    it('200 GET /campaigns/:campaignId/shortlist-share lists active links', async () => {
      svc.listShortlistShareLinks.mockResolvedValueOnce([{ token: 'tok-1' }]);
      await request(app.getHttpServer())
        .get('/campaigns/c1/shortlist-share')
        .expect(200);
      expect(svc.listShortlistShareLinks).toHaveBeenCalledWith(
        TEST_USER_ID,
        'c1',
      );
    });

    it('200 DELETE /campaigns/shortlist-share/:linkId revokes a link', async () => {
      svc.revokeShortlistShareLink.mockResolvedValueOnce({ revoked: true });
      await request(app.getHttpServer())
        .delete('/campaigns/shortlist-share/link-1')
        .expect(200);
      expect(svc.revokeShortlistShareLink).toHaveBeenCalledWith(
        TEST_USER_ID,
        'link-1',
      );
    });
  });

  describe('Auth failures', () => {
    let noAuthApp: any;

    beforeAll(async () => {
      noAuthApp = await buildApp(AUTH_FAIL);
    });
    afterAll(() => noAuthApp.close());

    it('401 GET /campaigns without token', async () => {
      await request(noAuthApp.getHttpServer()).get('/campaigns').expect(401);
    });

    it('401 POST /campaigns without token', async () => {
      await request(noAuthApp.getHttpServer())
        .post('/campaigns')
        .send({ name: 'X' })
        .expect(401);
    });

    it('401 GET /campaigns/:id/shortlist without token', async () => {
      await request(noAuthApp.getHttpServer())
        .get('/campaigns/c1/shortlist')
        .expect(401);
    });
  });
});
