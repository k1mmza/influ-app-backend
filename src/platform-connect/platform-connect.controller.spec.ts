import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PlatformConnectController } from './platform-connect.controller';
import { PlatformConnectService } from './platform-connect.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AUTH_PASS, AUTH_FAIL, initApp, TEST_USER_ID } from '../test-utils';

const svc = {
  getAuthUrl: jest.fn(),
  handleCallback: jest.fn(),
  disconnectPlatform: jest.fn(),
};

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [PlatformConnectController],
    providers: [{ provide: PlatformConnectService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .compile();
  return initApp(module);
}

describe('PlatformConnectController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('POST /auth/platform/connect', () => {
    it('201 returns OAuth URL for given platform', async () => {
      svc.getAuthUrl.mockReturnValueOnce('https://tiktok.com/oauth?state=xyz');
      const res = await request(app.getHttpServer())
        .post('/auth/platform/connect')
        .send({ platform: 'tiktok' })
        .expect(201);
      expect(res.body.authUrl).toBe('https://tiktok.com/oauth?state=xyz');
      expect(svc.getAuthUrl).toHaveBeenCalledWith(TEST_USER_ID, 'tiktok');
    });

    it('400 on missing platform', async () => {
      await request(app.getHttpServer())
        .post('/auth/platform/connect')
        .send({})
        .expect(400);
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL);
      await request(noAuthApp.getHttpServer())
        .post('/auth/platform/connect')
        .send({ platform: 'tiktok' })
        .expect(401);
      await noAuthApp.close();
    });
  });

  describe('GET /auth/platform/connect/callback (public)', () => {
    it('200 handles successful OAuth callback with HTML redirect', async () => {
      svc.handleCallback.mockResolvedValueOnce(undefined);
      const res = await request(app.getHttpServer())
        .get(
          '/auth/platform/connect/callback?code=authcode&state=some.state.val',
        )
        .expect(200);
      expect(res.text).toContain('window.location.replace');
      expect(res.text).toContain('platform_connect=success');
      expect(svc.handleCallback).toHaveBeenCalledWith(
        'authcode',
        'some.state.val',
      );
    });

    it('200 handles OAuth error with error redirect', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/platform/connect/callback?error=access_denied')
        .expect(200);
      expect(res.text).toContain('platform_connect=error');
      expect(svc.handleCallback).not.toHaveBeenCalled();
    });

    it('200 handles missing code/state with error redirect', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/platform/connect/callback')
        .expect(200);
      expect(res.text).toContain('platform_connect=error');
    });

    it('200 handles service error with error redirect', async () => {
      svc.handleCallback.mockRejectedValueOnce(
        new Error('token exchange failed'),
      );
      const res = await request(app.getHttpServer())
        .get(
          '/auth/platform/connect/callback?code=badcode&state=some.state.val',
        )
        .expect(200);
      expect(res.text).toContain('platform_connect=error');
    });
  });

  describe('DELETE /auth/platform/connect', () => {
    it('200 disconnects platform', async () => {
      svc.disconnectPlatform.mockResolvedValueOnce(undefined);
      const res = await request(app.getHttpServer())
        .delete('/auth/platform/connect')
        .send({ platform: 'tiktok' })
        .expect(200);
      expect(res.body.message).toContain('tiktok');
      expect(svc.disconnectPlatform).toHaveBeenCalledWith(
        TEST_USER_ID,
        'tiktok',
      );
    });

    it('400 on missing platform', async () => {
      await request(app.getHttpServer())
        .delete('/auth/platform/connect')
        .send({})
        .expect(400);
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL);
      await request(noAuthApp.getHttpServer())
        .delete('/auth/platform/connect')
        .send({ platform: 'tiktok' })
        .expect(401);
      await noAuthApp.close();
    });
  });
});
