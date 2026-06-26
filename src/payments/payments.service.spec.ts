/**
 * TEST PLAN — PaymentsService (manual-proof payment flow)
 * =======================================================
 * Plain unit tests with a hand-rolled mock Prisma.
 *
 * Status machine: PENDING → AWAITING_CONFIRMATION → PAID
 *
 * TC-01: BRAND creates a payment in PENDING
 * TC-02: INFLUENCER cannot create a payment (Forbidden)
 * TC-03: BRAND uploads proof → AWAITING_CONFIRMATION
 * TC-04: INFLUENCER cannot upload proof (Forbidden)
 * TC-05: INFLUENCER confirms AWAITING_CONFIRMATION → PAID + wallet credited
 * TC-06: BRAND cannot confirm (Forbidden) — no unilateral PAID
 * TC-07: Cannot confirm a PENDING payment (BadRequest) — can't skip the proof step
 * TC-08: Cannot confirm an already-PAID payment (BadRequest)
 */

import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

const INF_USER = {
  id: 'u-inf',
  role: 'INFLUENCER',
  influencerProfile: { id: 'inf-1' },
  brandProfile: null,
  agencyProfile: null,
};
const BRAND_USER = {
  id: 'u-brand',
  role: 'BRAND',
  influencerProfile: null,
  brandProfile: { id: 'bp-1' },
  agencyProfile: null,
};
const CONV = {
  id: 'conv-1',
  campaignId: 'camp-1',
  clientBrandId: 'cb-1',
  influencerId: 'inf-1',
  clientBrand: { id: 'cb-1', brandProfileId: 'bp-1', agencyId: null },
};

function payment(overrides: any = {}) {
  return {
    id: 'pay-1',
    campaignId: 'camp-1',
    clientBrandId: 'cb-1',
    influencerId: 'inf-1',
    amount: 9000,
    status: 'PENDING',
    proofUrl: null,
    confirmedAt: null,
    paidAt: null,
    ...overrides,
  };
}

function build(user: any, existingPayment: any = payment()) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    conversation: { findUnique: jest.fn().mockResolvedValue(CONV) },
    payment: {
      findMany: jest.fn().mockResolvedValue([existingPayment]),
      findUnique: jest.fn().mockResolvedValue(existingPayment),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ ...payment(), ...data })),
      update: jest
        .fn()
        .mockImplementation(({ data }) => ({ ...existingPayment, ...data })),
    },
    wallet: {
      upsert: jest
        .fn()
        .mockResolvedValue({ userId: user.id, totalEarned: 9000 }),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (arr: any[]) => Promise.all(arr)),
  };
  const gateway: any = { emitPaymentsUpdate: jest.fn() };
  const service = new PaymentsService(prisma, gateway);
  return { service, prisma, gateway };
}

describe('PaymentsService status transitions', () => {
  it('TC-01: brand creates a payment in PENDING', async () => {
    const { service, prisma } = build(BRAND_USER);
    const res = await service.create('u-brand', 'conv-1', { amount: 9000 });
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('PENDING');
  });

  it('TC-02: influencer cannot create a payment', async () => {
    const { service } = build(INF_USER);
    await expect(
      service.create('u-inf', 'conv-1', { amount: 9000 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('TC-03: brand uploads proof → AWAITING_CONFIRMATION', async () => {
    const { service } = build(BRAND_USER, payment({ status: 'PENDING' }));
    const res = await service.uploadProof(
      'u-brand',
      'conv-1',
      'pay-1',
      '/uploads/conversations/x.png',
    );
    expect(res.status).toBe('AWAITING_CONFIRMATION');
    expect(res.proofUrl).toBe('/uploads/conversations/x.png');
  });

  it('TC-04: influencer cannot upload proof', async () => {
    const { service } = build(INF_USER, payment({ status: 'PENDING' }));
    await expect(
      service.uploadProof('u-inf', 'conv-1', 'pay-1', '/uploads/x.png'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('TC-05: influencer confirms AWAITING_CONFIRMATION → PAID + wallet credited', async () => {
    const { service, prisma, gateway } = build(
      INF_USER,
      payment({ status: 'AWAITING_CONFIRMATION', proofUrl: '/uploads/x.png' }),
    );
    const res = await service.confirm('u-inf', 'conv-1', 'pay-1');
    expect(res.status).toBe('PAID');
    expect(prisma.wallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u-inf' },
        update: expect.objectContaining({
          totalEarned: { increment: 9000 },
          lastPaymentAmount: 9000,
        }),
      }),
    );
    expect(gateway.emitPaymentsUpdate).toHaveBeenCalledWith('conv-1');
  });

  it('TC-06: brand cannot confirm (no unilateral PAID)', async () => {
    const { service, prisma } = build(
      BRAND_USER,
      payment({ status: 'AWAITING_CONFIRMATION' }),
    );
    await expect(
      service.confirm('u-brand', 'conv-1', 'pay-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.wallet.upsert).not.toHaveBeenCalled();
  });

  it('TC-07: cannot confirm a PENDING payment (skip not allowed)', async () => {
    const { service } = build(INF_USER, payment({ status: 'PENDING' }));
    await expect(
      service.confirm('u-inf', 'conv-1', 'pay-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC-08: cannot confirm an already-PAID payment', async () => {
    const { service } = build(INF_USER, payment({ status: 'PAID' }));
    await expect(
      service.confirm('u-inf', 'conv-1', 'pay-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
