import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
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
  list: jest.fn(),
  create: jest.fn(),
  uploadProof: jest.fn(),
  confirm: jest.fn(),
};

async function buildApp(jwtMock: object, rolesMock: object) {
  const module = await Test.createTestingModule({
    controllers: [PaymentsController],
    providers: [{ provide: PaymentsService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .overrideGuard(RolesGuard)
    .useValue(rolesMock)
    .compile();
  return initApp(module);
}

describe('PaymentsController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS, ROLE_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const CONV = 'conv-1';
  const PAYMENT = 'pay-1';
  const base = `/conversations/${CONV}/payments`;

  describe(`GET ${base}`, () => {
    it('200 returns payments for conversation', async () => {
      svc.list.mockResolvedValueOnce([{ id: PAYMENT, amount: 500 }]);
      const res = await request(app.getHttpServer()).get(base).expect(200);
      expect(res.body).toHaveLength(1);
      expect(svc.list).toHaveBeenCalledWith(TEST_USER_ID, CONV);
    });
  });

  describe(`POST ${base}`, () => {
    it('201 creates payment with valid amount', async () => {
      svc.create.mockResolvedValueOnce({ id: PAYMENT, amount: 500 });
      const res = await request(app.getHttpServer())
        .post(base)
        .send({ amount: 500 })
        .expect(201);
      expect(res.body.amount).toBe(500);
      expect(svc.create).toHaveBeenCalledWith(
        TEST_USER_ID,
        CONV,
        expect.objectContaining({ amount: 500 }),
      );
    });

    it('400 on missing amount', async () => {
      await request(app.getHttpServer()).post(base).send({}).expect(400);
    });

    it('400 on zero amount (not positive)', async () => {
      await request(app.getHttpServer())
        .post(base)
        .send({ amount: 0 })
        .expect(400);
    });

    it('400 on negative amount', async () => {
      await request(app.getHttpServer())
        .post(base)
        .send({ amount: -100 })
        .expect(400);
    });

    it('400 on string amount', async () => {
      await request(app.getHttpServer())
        .post(base)
        .send({ amount: 'free' })
        .expect(400);
    });
  });

  describe(`POST ${base}/:paymentId/proof`, () => {
    it('201 uploads payment proof', async () => {
      svc.uploadProof.mockResolvedValueOnce({
        id: PAYMENT,
        proofUrl: '/uploads/conversations/proof.jpg',
      });
      await request(app.getHttpServer())
        .post(`${base}/${PAYMENT}/proof`)
        .attach('file', Buffer.from('fake-receipt'), {
          filename: 'receipt.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
      expect(svc.uploadProof).toHaveBeenCalledWith(
        TEST_USER_ID,
        CONV,
        PAYMENT,
        expect.stringContaining('/uploads/conversations/'),
      );
    });
  });

  describe(`PATCH ${base}/:paymentId/confirm`, () => {
    it('200 confirms payment', async () => {
      svc.confirm.mockResolvedValueOnce({ id: PAYMENT, confirmed: true });
      await request(app.getHttpServer())
        .patch(`${base}/${PAYMENT}/confirm`)
        .expect(200);
      expect(svc.confirm).toHaveBeenCalledWith(TEST_USER_ID, CONV, PAYMENT);
    });

    it('404 when payment not found', async () => {
      svc.confirm.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .patch(`${base}/nonexistent/confirm`)
        .expect(404);
    });
  });

  describe('Auth and role failures', () => {
    it('401 GET payments without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL, ROLE_PASS);
      await request(noAuthApp.getHttpServer()).get(base).expect(401);
      await noAuthApp.close();
    });

    it('403 POST payment with wrong role', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer())
        .post(base)
        .send({ amount: 100 })
        .expect(403);
      await noRoleApp.close();
    });
  });
});
