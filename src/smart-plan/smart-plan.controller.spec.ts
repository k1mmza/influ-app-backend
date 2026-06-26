import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { SmartPlanController } from './smart-plan.controller';
import { SmartPlanService } from './smart-plan.service';
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
  generate: jest.fn(),
  createCampaignFromPlan: jest.fn(),
  saveBrief: jest.fn(),
  getLatestBrief: jest.fn(),
  getBriefByCampaign: jest.fn(),
};

async function buildApp(jwtMock: object, rolesMock: object) {
  const module = await Test.createTestingModule({
    controllers: [SmartPlanController],
    providers: [{ provide: SmartPlanService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .overrideGuard(RolesGuard)
    .useValue(rolesMock)
    .compile();
  return initApp(module);
}

describe('SmartPlanController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS, ROLE_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('POST /smart-plan/generate', () => {
    it('201 generates brief from structured fields', async () => {
      svc.generate.mockResolvedValueOnce({
        strategy: 'Focus on...',
        concept: 'Create...',
      });
      const res = await request(app.getHttpServer())
        .post('/smart-plan/generate')
        .send({ campaignName: 'Summer Launch', objective: 'Brand awareness' })
        .expect(201);
      expect(res.body.strategy).toBeDefined();
      expect(svc.generate).toHaveBeenCalledWith(
        expect.objectContaining({ campaignName: 'Summer Launch' }),
      );
    });

    it('201 with empty body (all fields optional)', async () => {
      svc.generate.mockResolvedValueOnce({ strategy: 'Default strategy' });
      await request(app.getHttpServer())
        .post('/smart-plan/generate')
        .send({})
        .expect(201);
    });

    it('201 with rawPrompt only', async () => {
      svc.generate.mockResolvedValueOnce({ strategy: 'From prompt' });
      await request(app.getHttpServer())
        .post('/smart-plan/generate')
        .send({
          rawPrompt:
            'Create a campaign for a new sneaker brand targeting Gen Z',
        })
        .expect(201);
    });

    it('400 on unrecognised field', async () => {
      await request(app.getHttpServer())
        .post('/smart-plan/generate')
        .send({ hackerField: 'bad' })
        .expect(400);
    });
  });

  describe('POST /smart-plan/create-campaign', () => {
    it('201 creates campaign from plan', async () => {
      svc.createCampaignFromPlan.mockResolvedValueOnce({
        id: 'camp-1',
        name: 'New Campaign',
      });
      const res = await request(app.getHttpServer())
        .post('/smart-plan/create-campaign')
        .send({ campaignFields: { name: 'New Campaign', budget: 5000 } })
        .expect(201);
      expect(res.body.id).toBe('camp-1');
      expect(svc.createCampaignFromPlan).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          campaignFields: { name: 'New Campaign', budget: 5000 },
        }),
      );
    });

    it('400 on missing required campaignFields', async () => {
      await request(app.getHttpServer())
        .post('/smart-plan/create-campaign')
        .send({ strategy: 'some strategy' })
        .expect(400);
    });
  });

  describe('POST /smart-plan/save', () => {
    it('201 saves brief for user', async () => {
      svc.saveBrief.mockResolvedValueOnce({ id: 'brief-1' });
      await request(app.getHttpServer())
        .post('/smart-plan/save')
        .send({
          strategy: 'Focus on engagement',
          briefBody: 'Full brief text...',
        })
        .expect(201);
      expect(svc.saveBrief).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ strategy: 'Focus on engagement' }),
      );
    });

    it('201 with empty body (all fields optional)', async () => {
      svc.saveBrief.mockResolvedValueOnce({ id: 'brief-1' });
      await request(app.getHttpServer())
        .post('/smart-plan/save')
        .send({})
        .expect(201);
    });
  });

  describe('GET /smart-plan/brief', () => {
    it('200 returns latest standalone brief', async () => {
      svc.getLatestBrief.mockResolvedValueOnce({
        id: 'brief-1',
        strategy: 'Growth strategy',
      });
      const res = await request(app.getHttpServer())
        .get('/smart-plan/brief')
        .expect(200);
      expect(res.body.id).toBe('brief-1');
      expect(svc.getLatestBrief).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('200 when no brief exists (empty response)', async () => {
      svc.getLatestBrief.mockResolvedValueOnce(null);
      await request(app.getHttpServer()).get('/smart-plan/brief').expect(200);
      expect(svc.getLatestBrief).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });

  describe('GET /smart-plan/brief/by-campaign/:campaignId', () => {
    it('200 returns brief for campaign', async () => {
      svc.getBriefByCampaign.mockResolvedValueOnce({
        id: 'brief-1',
        campaignId: 'camp-1',
      });
      const res = await request(app.getHttpServer())
        .get('/smart-plan/brief/by-campaign/camp-1')
        .expect(200);
      expect(res.body.campaignId).toBe('camp-1');
      expect(svc.getBriefByCampaign).toHaveBeenCalledWith('camp-1');
    });

    it('404 when brief not found for campaign', async () => {
      svc.getBriefByCampaign.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .get('/smart-plan/brief/by-campaign/nonexistent')
        .expect(404);
    });
  });

  describe('Auth and role failures', () => {
    it('401 POST /smart-plan/generate without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL, ROLE_PASS);
      await request(noAuthApp.getHttpServer())
        .post('/smart-plan/generate')
        .send({})
        .expect(401);
      await noAuthApp.close();
    });

    it('403 GET /smart-plan/brief with wrong role', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer())
        .get('/smart-plan/brief')
        .expect(403);
      await noRoleApp.close();
    });
  });
});
