import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AUTH_PASS, AUTH_FAIL, ROLE_PASS, ROLE_FAIL, initApp, TEST_USER_ID } from '../test-utils';

const svc = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  review: jest.fn(),
  saveUpload: jest.fn(),
};

async function buildApp(jwtMock: object, rolesMock: object) {
  const module = await Test.createTestingModule({
    controllers: [DraftsController],
    providers: [{ provide: DraftsService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard).useValue(jwtMock)
    .overrideGuard(RolesGuard).useValue(rolesMock)
    .compile();
  return initApp(module);
}

describe('DraftsController', () => {
  let app: any;

  beforeAll(async () => { app = await buildApp(AUTH_PASS, ROLE_PASS); });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const CONV = 'conv-1';
  const DRAFT = 'draft-1';
  const base = `/conversations/${CONV}/drafts`;

  describe(`GET ${base}`, () => {
    it('200 returns drafts for conversation', async () => {
      svc.list.mockResolvedValueOnce([{ id: DRAFT, title: 'Draft 1' }]);
      const res = await request(app.getHttpServer()).get(base).expect(200);
      expect(res.body).toHaveLength(1);
      expect(svc.list).toHaveBeenCalledWith(TEST_USER_ID, CONV);
    });
  });

  describe(`POST ${base}`, () => {
    it('201 creates draft with required title', async () => {
      svc.create.mockResolvedValueOnce({ id: DRAFT, title: 'My Draft' });
      await request(app.getHttpServer())
        .post(base)
        .send({ title: 'My Draft' })
        .expect(201);
      expect(svc.create).toHaveBeenCalledWith(TEST_USER_ID, CONV, expect.objectContaining({ title: 'My Draft' }));
    });

    it('400 on missing title', async () => {
      await request(app.getHttpServer()).post(base).send({}).expect(400);
    });

    it('400 on title exceeding 200 chars', async () => {
      await request(app.getHttpServer())
        .post(base)
        .send({ title: 'x'.repeat(201) })
        .expect(400);
    });

    it('400 on invalid contentType value', async () => {
      await request(app.getHttpServer())
        .post(base)
        .send({ title: 'Draft', contentType: 'invalid-type' })
        .expect(400);
    });

    it('201 with valid contentType link', async () => {
      svc.create.mockResolvedValueOnce({ id: DRAFT });
      await request(app.getHttpServer())
        .post(base)
        .send({ title: 'Link Draft', contentType: 'link', linkUrl: 'https://example.com' })
        .expect(201);
    });
  });

  describe(`PATCH ${base}/:draftId`, () => {
    it('200 updates draft', async () => {
      svc.update.mockResolvedValueOnce({ id: DRAFT, title: 'Updated' });
      await request(app.getHttpServer())
        .patch(`${base}/${DRAFT}`)
        .send({ title: 'Updated' })
        .expect(200);
    });

    it('400 on invalid status', async () => {
      await request(app.getHttpServer())
        .patch(`${base}/${DRAFT}`)
        .send({ status: 'APPROVED' })
        .expect(400);
    });

    it('200 with valid status SUBMITTED', async () => {
      svc.update.mockResolvedValueOnce({ id: DRAFT, status: 'SUBMITTED' });
      await request(app.getHttpServer())
        .patch(`${base}/${DRAFT}`)
        .send({ status: 'SUBMITTED' })
        .expect(200);
    });

    it('404 when draft not found', async () => {
      svc.update.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer()).patch(`${base}/nonexistent`).send({ title: 'X' }).expect(404);
    });
  });

  describe(`DELETE ${base}/:draftId`, () => {
    it('200 removes draft', async () => {
      svc.remove.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer()).delete(`${base}/${DRAFT}`).expect(200);
      expect(svc.remove).toHaveBeenCalledWith(TEST_USER_ID, CONV, DRAFT);
    });

    it('404 when draft not found', async () => {
      svc.remove.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer()).delete(`${base}/nonexistent`).expect(404);
    });
  });

  describe(`PATCH ${base}/:draftId/review`, () => {
    it('200 approves draft', async () => {
      svc.review.mockResolvedValueOnce({ id: DRAFT, status: 'APPROVED' });
      await request(app.getHttpServer())
        .patch(`${base}/${DRAFT}/review`)
        .send({ status: 'APPROVED' })
        .expect(200);
    });

    it('200 requests revision', async () => {
      svc.review.mockResolvedValueOnce({ id: DRAFT, status: 'REVISION_REQUESTED' });
      await request(app.getHttpServer())
        .patch(`${base}/${DRAFT}/review`)
        .send({ status: 'REVISION_REQUESTED', revisionNote: 'Please fix the caption.' })
        .expect(200);
    });

    it('400 on missing status', async () => {
      await request(app.getHttpServer()).patch(`${base}/${DRAFT}/review`).send({}).expect(400);
    });

    it('400 on invalid status value', async () => {
      await request(app.getHttpServer())
        .patch(`${base}/${DRAFT}/review`)
        .send({ status: 'PENDING' })
        .expect(400);
    });
  });

  describe(`POST ${base}/:draftId/upload`, () => {
    it('201 uploads file for draft', async () => {
      svc.saveUpload.mockResolvedValueOnce({ url: '/uploads/conversations/test.jpg' });
      await request(app.getHttpServer())
        .post(`${base}/${DRAFT}/upload`)
        .attach('file', Buffer.from('fake-image'), { filename: 'test.jpg', contentType: 'image/jpeg' })
        .expect(201);
      expect(svc.saveUpload).toHaveBeenCalled();
    });
  });

  describe('Auth and role failures', () => {
    it('401 GET drafts without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL, ROLE_PASS);
      await request(noAuthApp.getHttpServer()).get(base).expect(401);
      await noAuthApp.close();
    });

    it('403 POST draft with wrong role', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer()).post(base).send({ title: 'X' }).expect(403);
      await noRoleApp.close();
    });
  });
});
