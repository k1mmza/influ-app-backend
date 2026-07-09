import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PublicCampaignController } from './public-campaign.controller';
import { CampaignsService } from './campaigns.service';
import { initApp } from '../test-utils';

// Public, unauthenticated surface — no JwtAuthGuard. ThrottlerGuard is overridden
// with a pass-through so tests don't need Redis/throttle storage.
const svc = {
  getPublicCampaign: jest.fn(),
  getPublicInfluencerList: jest.fn(),
};

async function buildApp() {
  const module = await Test.createTestingModule({
    controllers: [PublicCampaignController],
    providers: [{ provide: CampaignsService, useValue: svc }],
  })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  return initApp(module);
}

describe('PublicCampaignController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('200 GET /public/campaigns/:token returns the public brief', async () => {
    svc.getPublicCampaign.mockResolvedValueOnce({ name: 'Camp' });
    const res = await request(app.getHttpServer())
      .get('/public/campaigns/tok-1')
      .expect(200);
    expect(res.body).toEqual({ name: 'Camp' });
    expect(svc.getPublicCampaign).toHaveBeenCalledWith('tok-1');
  });

  it('200 GET /public/campaigns/:token/influencers returns the influencer list', async () => {
    svc.getPublicInfluencerList.mockResolvedValueOnce({
      campaign: { name: 'Camp' },
      influencers: [{ influencerId: 'inf-1', proposedPrice: 5000 }],
    });
    const res = await request(app.getHttpServer())
      .get('/public/campaigns/tok-1/influencers')
      .expect(200);
    expect(res.body.influencers).toHaveLength(1);
    expect(svc.getPublicInfluencerList).toHaveBeenCalledWith('tok-1');
  });

  it('404 GET /public/campaigns/:token/influencers for an unknown/revoked/expired token', async () => {
    svc.getPublicInfluencerList.mockRejectedValueOnce(
      new NotFoundException('This link is no longer available'),
    );
    await request(app.getHttpServer())
      .get('/public/campaigns/dead-token/influencers')
      .expect(404);
  });
});
