import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PublicTrackingController } from './public-tracking.controller';
import { TrackingService } from './tracking.service';
import { initApp } from '../test-utils';

// Public, unauthenticated surface — no JwtAuthGuard. ThrottlerGuard is overridden
// with a pass-through so tests don't need Redis/throttle storage.
const svc = {
  getPublicReport: jest.fn(),
};

async function buildApp() {
  const module = await Test.createTestingModule({
    controllers: [PublicTrackingController],
    providers: [{ provide: TrackingService, useValue: svc }],
  })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  return initApp(module);
}

describe('PublicTrackingController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('200 GET /public/tracking/:token returns the public report', async () => {
    svc.getPublicReport.mockResolvedValueOnce({
      campaign: { name: 'Camp', status: 'ACTIVE' },
      progress: { totalDeliverables: 5, published: 2 },
    });
    const res = await request(app.getHttpServer())
      .get('/public/tracking/tok-1')
      .expect(200);
    expect(res.body.campaign.name).toBe('Camp');
    expect(svc.getPublicReport).toHaveBeenCalledWith('tok-1');
  });

  it('404 when token is invalid/expired/revoked/unknown', async () => {
    svc.getPublicReport.mockRejectedValueOnce(
      new NotFoundException('This report link is no longer available'),
    );
    await request(app.getHttpServer())
      .get('/public/tracking/dead-token')
      .expect(404);
  });
});
