/**
 * TEST PLAN — InvitationsService.invite (external-profile guard)
 * =============================================================
 * Hand-rolled prisma mock (matches tracking/drafts spec style). Focus: a brand
 * can only invite a creator that has a real user account behind the profile.
 *
 * IV-01: inviting an external/URL-derived profile (userId null) is rejected and
 *        creates NO CampaignApplication — even after a claim (still userId null).
 * IV-02: inviting a real registered influencer (userId set) creates an INVITED row
 */

import { BadRequestException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';

function build(influencer: any) {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        role: 'BRAND',
        brandProfile: { clientBrand: { id: 'cb-1' } },
        agencyProfile: null,
      }),
    },
    campaign: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'camp-1', clientBrandId: 'cb-1' }),
    },
    influencerProfile: {
      findUnique: jest.fn().mockResolvedValue(influencer),
    },
    campaignApplication: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: 'app-1', ...data })),
    },
  };
  const conversations: any = {};
  const service = new InvitationsService(prisma, conversations);
  return { service, prisma };
}

describe('InvitationsService.invite — external profile guard', () => {
  it('IV-01: rejects inviting an external profile (no user) and creates nothing', async () => {
    const { service, prisma } = build({
      id: 'inf-ext',
      userId: null, // external / URL-derived (also true for a claimed tombstone)
      isExternal: true,
    });

    await expect(
      service.invite('u-brand', 'camp-1', 'inf-ext'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.campaignApplication.create).not.toHaveBeenCalled();
  });

  it('IV-02: allows inviting a registered influencer (userId set)', async () => {
    const { service, prisma } = build({
      id: 'inf-real',
      userId: 'user-1',
      isExternal: false,
    });

    const res: any = await service.invite('u-brand', 'camp-1', 'inf-real');

    expect(res.inviteResult).toBe('INVITED');
    expect(prisma.campaignApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: 'camp-1',
          influencerId: 'inf-real',
          status: 'INVITED',
          origin: 'INVITATION',
        }),
      }),
    );
  });
});
