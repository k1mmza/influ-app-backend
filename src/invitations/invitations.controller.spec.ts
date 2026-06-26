import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
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
  invite: jest.fn(),
  getInvitations: jest.fn(),
  accept: jest.fn(),
  decline: jest.fn(),
};

async function buildApp(jwtMock: object, rolesMock: object) {
  const module = await Test.createTestingModule({
    controllers: [InvitationsController],
    providers: [{ provide: InvitationsService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .overrideGuard(RolesGuard)
    .useValue(rolesMock)
    .compile();
  return initApp(module);
}

describe('InvitationsController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS, ROLE_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('POST /campaigns/:id/invite', () => {
    it('201 invites influencer to campaign', async () => {
      svc.invite.mockResolvedValueOnce({ id: 'app-1', status: 'INVITED' });
      await request(app.getHttpServer())
        .post('/campaigns/camp-1/invite')
        .send({ influencerId: 'inf-1' })
        .expect(201);
      expect(svc.invite).toHaveBeenCalledWith(TEST_USER_ID, 'camp-1', 'inf-1');
    });

    it('400 on missing influencerId', async () => {
      await request(app.getHttpServer())
        .post('/campaigns/camp-1/invite')
        .send({})
        .expect(400);
    });

    it('404 when campaign not found', async () => {
      svc.invite.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .post('/campaigns/nonexistent/invite')
        .send({ influencerId: 'inf-1' })
        .expect(404);
    });
  });

  describe('GET /invitations', () => {
    it('200 returns invitations for influencer', async () => {
      svc.getInvitations.mockResolvedValueOnce([
        { id: 'app-1', status: 'INVITED' },
      ]);
      const res = await request(app.getHttpServer())
        .get('/invitations')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(svc.getInvitations).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });

  describe('POST /invitations/:id/accept', () => {
    it('201 accepts invitation', async () => {
      svc.accept.mockResolvedValueOnce({ id: 'app-1', status: 'ACCEPTED' });
      await request(app.getHttpServer())
        .post('/invitations/app-1/accept')
        .expect(201);
      expect(svc.accept).toHaveBeenCalledWith(TEST_USER_ID, 'app-1');
    });

    it('404 when invitation not found', async () => {
      svc.accept.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .post('/invitations/nonexistent/accept')
        .expect(404);
    });
  });

  describe('POST /invitations/:id/decline', () => {
    it('201 declines invitation', async () => {
      svc.decline.mockResolvedValueOnce({ id: 'app-1', status: 'DECLINED' });
      await request(app.getHttpServer())
        .post('/invitations/app-1/decline')
        .expect(201);
      expect(svc.decline).toHaveBeenCalledWith(TEST_USER_ID, 'app-1');
    });

    it('404 when invitation not found', async () => {
      svc.decline.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .post('/invitations/nonexistent/decline')
        .expect(404);
    });
  });

  describe('Auth and role failures', () => {
    it('401 GET /invitations without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL, ROLE_PASS);
      await request(noAuthApp.getHttpServer()).get('/invitations').expect(401);
      await noAuthApp.close();
    });

    it('403 POST /campaigns/:id/invite with wrong role', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer())
        .post('/campaigns/camp-1/invite')
        .send({ influencerId: 'inf-1' })
        .expect(403);
      await noRoleApp.close();
    });
  });
});
