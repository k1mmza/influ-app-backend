import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AUTH_PASS, AUTH_FAIL, initApp } from '../test-utils';

const svc = {
  findAll: jest.fn(),
  lookupByHandle: jest.fn(),
  getClaimCandidates: jest.fn(),
  claimProfile: jest.fn(),
  findOne: jest.fn(),
};

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [InfluencersController],
    providers: [{ provide: InfluencersService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard).useValue(jwtMock)
    .compile();
  return initApp(module);
}

describe('InfluencersController', () => {
  let app: any;

  beforeAll(async () => { app = await buildApp(AUTH_PASS); });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /influencers (public)', () => {
    it('200 returns influencers list', async () => {
      svc.findAll.mockResolvedValueOnce([{ id: 'inf-1' }]);
      const res = await request(app.getHttpServer()).get('/influencers').expect(200);
      expect(res.body).toEqual([{ id: 'inf-1' }]);
    });

    it('200 passes query filters to service', async () => {
      svc.findAll.mockResolvedValueOnce([]);
      await request(app.getHttpServer()).get('/influencers?gender=female&platform=instagram').expect(200);
      expect(svc.findAll).toHaveBeenCalledWith(expect.objectContaining({ gender: 'female', platform: 'instagram' }));
    });

    it('400 when service rejects invalid gender (controller passes it through, service validates)', async () => {
      svc.findAll.mockRejectedValueOnce(new BadRequestException('Invalid gender value'));
      await request(app.getHttpServer()).get('/influencers?gender=invalid').expect(400);
    });
  });

  describe('GET /influencers/lookup (public)', () => {
    it('200 looks up by platform and handle', async () => {
      svc.lookupByHandle.mockResolvedValueOnce({ id: 'inf-1', handle: '@test' });
      const res = await request(app.getHttpServer())
        .get('/influencers/lookup?platform=instagram&handle=testuser')
        .expect(200);
      expect(svc.lookupByHandle).toHaveBeenCalledWith('instagram', 'testuser');
    });

    it('400 on missing platform', async () => {
      await request(app.getHttpServer()).get('/influencers/lookup?handle=testuser').expect(400);
    });

    it('400 on missing handle', async () => {
      await request(app.getHttpServer()).get('/influencers/lookup?platform=instagram').expect(400);
    });

    it('400 on missing both params', async () => {
      await request(app.getHttpServer()).get('/influencers/lookup').expect(400);
    });
  });

  describe('GET /influencers/claim-candidates (JWT)', () => {
    it('200 returns claim candidates', async () => {
      svc.getClaimCandidates.mockResolvedValueOnce([{ id: 'inf-ext-1' }]);
      const res = await request(app.getHttpServer())
        .get('/influencers/claim-candidates?influencerId=inf-1')
        .expect(200);
      expect(svc.getClaimCandidates).toHaveBeenCalledWith('inf-1');
    });

    it('400 on missing influencerId', async () => {
      await request(app.getHttpServer()).get('/influencers/claim-candidates').expect(400);
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL);
      await request(noAuthApp.getHttpServer())
        .get('/influencers/claim-candidates?influencerId=inf-1')
        .expect(401);
      await noAuthApp.close();
    });
  });

  describe('POST /influencers/claim/:externalInfluencerId (JWT)', () => {
    it('201 claims external profile', async () => {
      svc.claimProfile.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer())
        .post('/influencers/claim/ext-inf-1')
        .send({ claimerInfluencerId: 'inf-1' })
        .expect(201);
      expect(svc.claimProfile).toHaveBeenCalledWith('ext-inf-1', 'inf-1');
    });

    it('400 on missing claimerInfluencerId', async () => {
      await request(app.getHttpServer())
        .post('/influencers/claim/ext-inf-1')
        .send({})
        .expect(400);
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL);
      await request(noAuthApp.getHttpServer())
        .post('/influencers/claim/ext-inf-1')
        .send({ claimerInfluencerId: 'inf-1' })
        .expect(401);
      await noAuthApp.close();
    });
  });

  describe('GET /influencers/:id (public)', () => {
    it('200 returns influencer by id', async () => {
      svc.findOne.mockResolvedValueOnce({ id: 'inf-1', name: 'Test Influencer' });
      const res = await request(app.getHttpServer()).get('/influencers/inf-1').expect(200);
      expect(res.body.id).toBe('inf-1');
    });

    it('404 when influencer not found', async () => {
      svc.findOne.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer()).get('/influencers/nonexistent').expect(404);
    });
  });
});
