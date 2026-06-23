/**
 * TEST PLAN — Campaign ↔ Conversation Integration
 * =================================================
 *
 * SCOPE: CampaignsService (backend unit tests, no NestJS TestingModule)
 *
 * updateApplicationStatus
 * -------------------------
 * TC-01: ACCEPTED creates a new conversation when none exists
 * TC-02: ACCEPTED is idempotent — reuses existing conversation
 * TC-03: REJECTED does NOT create a conversation; conversationId is null
 * TC-04: PENDING does NOT create a conversation; conversationId is null
 * TC-05: Brand that does NOT own campaign → throws NotFoundException (not ForbiddenException)
 * TC-06: Response always includes a conversationId field
 *
 * getApplications
 * ---------------
 * TC-07: prisma.conversation.findMany called exactly once regardless of application count
 * TC-08: ACCEPTED applications receive conversationId from the in-memory map
 * TC-09: Non-matched applications receive conversationId: null
 */

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { ConversationsService } from '../conversations/conversations.service';

// CampaignsService gained a ConversationsService dependency (the ensureConversation
// consolidation). The ACCEPTED path calls `this.conversations.ensureConversation(..., tx)`,
// which itself runs `tx.conversation.findFirst` / `tx.conversation.create` — exactly the
// inline find-or-create these tests were written against. Injecting a REAL ConversationsService
// (with a stub gateway) that operates on the test's tx proxy therefore preserves every existing
// assertion (e.g. prisma.__lastTx.conversation.create) with no behavioural change.
function makeConvService(prisma: any): ConversationsService {
  return new ConversationsService(prisma, {} as any);
}

// ---------------------------------------------------------------------------
// Helpers to build realistic mock shapes
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<any> = {}) {
  return {
    id: 'user-brand-1',
    name: 'Acme Brand',
    email: 'brand@acme.com',
    role: 'BRAND',
    brandProfile: {
      id: 'bp-1',
      companyName: 'Acme Co',
      telephone: null,
      websiteUrl: null,
    },
    agencyProfile: null,
    influencerProfile: null,
    ...overrides,
  };
}

function makeClientBrand(overrides: Partial<any> = {}) {
  return {
    id: 'cb-1',
    brandProfileId: 'bp-1',
    agencyId: null,
    brandName: 'Acme Co',
    brandEmail: 'brand@acme.com',
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<any> = {}) {
  return {
    id: 'campaign-1',
    name: 'Summer Campaign',
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    clientBrand: makeClientBrand(),
    requirements: [],
    applications: [],
    ...overrides,
  };
}

function makeApplication(overrides: Partial<any> = {}) {
  return {
    id: 'app-1',
    campaignId: 'campaign-1',
    influencerId: 'inf-1',
    status: 'PENDING',
    ...overrides,
  };
}

function makeConversation(overrides: Partial<any> = {}) {
  return {
    id: 'conv-1',
    influencerId: 'inf-1',
    clientBrandId: 'cb-1',
    campaignId: 'campaign-1',
    workPhase: 'brief',
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build a mock PrismaService with all methods used by CampaignsService
// ---------------------------------------------------------------------------

function buildPrisma(overrides: Record<string, any> = {}): any {
  const mockPrisma: any = {
    user: {
      findUnique: jest.fn(),
    },
    campaign: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    clientBrand: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    campaignApplication: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    campaignRequirement: {
      deleteMany: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    // $transaction will be overridden per test where needed
    $transaction: jest.fn(),
  };

  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    mockPrisma[key] = { ...mockPrisma[key], ...value };
  }

  return mockPrisma;
}

// ---------------------------------------------------------------------------
// updateApplicationStatus tests
// ---------------------------------------------------------------------------

describe('CampaignsService.updateApplicationStatus', () => {
  // -----------------------------------------------------------------------
  // TC-01: ACCEPTED — creates a new conversation when none exists
  // -----------------------------------------------------------------------
  it('TC-01: ACCEPTED creates a new conversation when none exists', async () => {
    const user = makeUser();
    const campaign = makeCampaign();
    const application = makeApplication({ status: 'PENDING' });
    const newConversation = makeConversation();

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.campaignApplication.findUnique.mockResolvedValue(application);

    // Simulate $transaction: the callback receives a tx proxy
    prisma.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue(null), // no existing conv
          create: jest.fn().mockResolvedValue(newConversation),
        },
        campaignApplication: {
          update: jest
            .fn()
            .mockResolvedValue({ ...application, status: 'ACCEPTED' }),
        },
      };
      const result = await cb(tx);
      // Expose tx so we can assert on it
      prisma.__lastTx = tx;
      return result;
    });

    const service = new CampaignsService(prisma, makeConvService(prisma));
    const result = await service.updateApplicationStatus(
      'user-brand-1',
      'campaign-1',
      'app-1',
      'ACCEPTED',
    );

    expect(result.conversationId).toBe('conv-1');
    expect(prisma.__lastTx.conversation.create).toHaveBeenCalledTimes(1);
    expect(prisma.__lastTx.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          influencerId: application.influencerId,
          clientBrandId: campaign.clientBrand.id,
          campaignId: campaign.id,
        }),
      }),
    );
  });

  // -----------------------------------------------------------------------
  // TC-02: ACCEPTED — idempotent: reuses existing conversation
  // -----------------------------------------------------------------------
  it('TC-02: ACCEPTED is idempotent — reuses existing conversation (no duplicate create)', async () => {
    const user = makeUser();
    const campaign = makeCampaign();
    const application = makeApplication({ status: 'PENDING' });
    const existingConversation = makeConversation({ id: 'conv-existing' });

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.campaignApplication.findUnique.mockResolvedValue(application);

    prisma.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue(existingConversation), // already exists
          create: jest.fn(),
        },
        campaignApplication: {
          update: jest
            .fn()
            .mockResolvedValue({ ...application, status: 'ACCEPTED' }),
        },
      };
      const result = await cb(tx);
      prisma.__lastTx = tx;
      return result;
    });

    const service = new CampaignsService(prisma, makeConvService(prisma));
    const result = await service.updateApplicationStatus(
      'user-brand-1',
      'campaign-1',
      'app-1',
      'ACCEPTED',
    );

    expect(result.conversationId).toBe('conv-existing');
    expect(prisma.__lastTx.conversation.create).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // TC-03: REJECTED — does NOT create conversation; conversationId is null
  // -----------------------------------------------------------------------
  it('TC-03: REJECTED does NOT create a conversation and returns conversationId: null', async () => {
    const user = makeUser();
    const campaign = makeCampaign();
    const application = makeApplication({ status: 'PENDING' });

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.campaignApplication.findUnique.mockResolvedValue(application);
    prisma.campaignApplication.update.mockResolvedValue({
      ...application,
      status: 'REJECTED',
    });

    const service = new CampaignsService(prisma, makeConvService(prisma));
    const result = await service.updateApplicationStatus(
      'user-brand-1',
      'campaign-1',
      'app-1',
      'REJECTED',
    );

    expect(result.conversationId).toBeNull();
    // $transaction should never have been entered for non-ACCEPTED
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // TC-04: PENDING — does NOT create conversation; conversationId is null
  // -----------------------------------------------------------------------
  it('TC-04: PENDING does NOT create a conversation and returns conversationId: null', async () => {
    const user = makeUser();
    const campaign = makeCampaign();
    const application = makeApplication({ status: 'ACCEPTED' }); // changing back to PENDING

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.campaignApplication.findUnique.mockResolvedValue(application);
    prisma.campaignApplication.update.mockResolvedValue({
      ...application,
      status: 'PENDING',
    });

    const service = new CampaignsService(prisma, makeConvService(prisma));
    const result = await service.updateApplicationStatus(
      'user-brand-1',
      'campaign-1',
      'app-1',
      'PENDING',
    );

    expect(result.conversationId).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // TC-05: Brand that does NOT own campaign → NotFoundException
  //   NOTE: assertCampaignOwnership throws NotFoundException, NOT ForbiddenException.
  //   This is by design (security-through-obscurity: treat unauthorized as not-found).
  // -----------------------------------------------------------------------
  it('TC-05: brand that does not own campaign gets NotFoundException (not ForbiddenException)', async () => {
    const user = makeUser({
      brandProfile: { id: 'bp-OTHER' }, // different brand profile
    });
    // Campaign is owned by bp-1, not bp-OTHER
    const campaign = makeCampaign({
      clientBrand: makeClientBrand({ brandProfileId: 'bp-1' }),
    });

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);

    const service = new CampaignsService(prisma, makeConvService(prisma));

    await expect(
      service.updateApplicationStatus(
        'user-brand-1',
        'campaign-1',
        'app-1',
        'ACCEPTED',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // -----------------------------------------------------------------------
  // TC-06: Response always contains a conversationId field
  // -----------------------------------------------------------------------
  it('TC-06: response always includes a conversationId key regardless of status', async () => {
    const user = makeUser();
    const campaign = makeCampaign();
    const application = makeApplication({ status: 'PENDING' });

    // Test REJECTED path
    const prismaRej = buildPrisma();
    prismaRej.user.findUnique.mockResolvedValue(user);
    prismaRej.campaign.findUnique.mockResolvedValue(campaign);
    prismaRej.campaignApplication.findUnique.mockResolvedValue(application);
    prismaRej.campaignApplication.update.mockResolvedValue({
      ...application,
      status: 'REJECTED',
    });

    const serviceRej = new CampaignsService(prismaRej, makeConvService(prismaRej));
    const rejResult = await serviceRej.updateApplicationStatus(
      'user-brand-1',
      'campaign-1',
      'app-1',
      'REJECTED',
    );

    expect('conversationId' in rejResult).toBe(true);
    expect(rejResult.conversationId).toBeNull();

    // Test ACCEPTED path
    const newConversation = makeConversation({ id: 'conv-acc' });
    const prismaAcc = buildPrisma();
    prismaAcc.user.findUnique.mockResolvedValue(user);
    prismaAcc.campaign.findUnique.mockResolvedValue(campaign);
    prismaAcc.campaignApplication.findUnique.mockResolvedValue(application);
    prismaAcc.$transaction.mockImplementation(async (cb: Function) => {
      const tx = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(newConversation),
        },
        campaignApplication: {
          update: jest
            .fn()
            .mockResolvedValue({ ...application, status: 'ACCEPTED' }),
        },
      };
      return cb(tx);
    });

    const serviceAcc = new CampaignsService(prismaAcc, makeConvService(prismaAcc));
    const accResult = await serviceAcc.updateApplicationStatus(
      'user-brand-1',
      'campaign-1',
      'app-1',
      'ACCEPTED',
    );

    expect('conversationId' in accResult).toBe(true);
    expect(accResult.conversationId).toBe('conv-acc');
  });

  // -----------------------------------------------------------------------
  // Guard: campaign not found
  // -----------------------------------------------------------------------
  it('throws NotFoundException when campaign does not exist', async () => {
    const user = makeUser();

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(null);

    const service = new CampaignsService(prisma, makeConvService(prisma));

    await expect(
      service.updateApplicationStatus(
        'user-brand-1',
        'campaign-missing',
        'app-1',
        'ACCEPTED',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // -----------------------------------------------------------------------
  // Guard: invalid status
  // -----------------------------------------------------------------------
  it('throws BadRequestException for an invalid status value', async () => {
    const user = makeUser();
    const campaign = makeCampaign();

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);

    const service = new CampaignsService(prisma, makeConvService(prisma));

    await expect(
      service.updateApplicationStatus(
        'user-brand-1',
        'campaign-1',
        'app-1',
        'INVALID_STATUS',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // -----------------------------------------------------------------------
  // Guard: application not found / belongs to different campaign
  // -----------------------------------------------------------------------
  it('throws NotFoundException when application does not belong to campaign', async () => {
    const user = makeUser();
    const campaign = makeCampaign();
    // Application belongs to a different campaign
    const application = makeApplication({ campaignId: 'campaign-OTHER' });

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.campaignApplication.findUnique.mockResolvedValue(application);

    const service = new CampaignsService(prisma, makeConvService(prisma));

    await expect(
      service.updateApplicationStatus(
        'user-brand-1',
        'campaign-1',
        'app-1',
        'ACCEPTED',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // -----------------------------------------------------------------------
  // Guard: campaign has no clientBrand
  //
  // NOTE: assertCampaignOwnership runs BEFORE the clientBrand null-check.
  // When clientBrand is null, campaign.clientBrand?.brandProfileId is undefined,
  // which never equals user.brandProfile.id — so assertCampaignOwnership throws
  // NotFoundException before we reach the BadRequestException branch.
  // This is the actual production behaviour as of the current implementation.
  //
  // TODO: if the ownership check is ever relaxed, the inner null-check on
  // clientBrand would surface as a BadRequestException. Document both cases.
  // -----------------------------------------------------------------------
  it('throws NotFoundException when campaign has no clientBrand (ownership check fires first)', async () => {
    const user = makeUser();
    // clientBrand: null means assertCampaignOwnership sees brandProfileId: undefined ≠ bp-1
    const campaign = makeCampaign({ clientBrand: null });
    const application = makeApplication();

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.campaignApplication.findUnique.mockResolvedValue(application);

    const service = new CampaignsService(prisma, makeConvService(prisma));

    // assertCampaignOwnership fires first → NotFoundException (not BadRequestException)
    await expect(
      service.updateApplicationStatus(
        'user-brand-1',
        'campaign-1',
        'app-1',
        'ACCEPTED',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // -----------------------------------------------------------------------
  // Guard: campaign has clientBrand but clientBrand.id is falsy — reaches
  //        the inner BadRequestException in the ACCEPTED branch.
  // -----------------------------------------------------------------------
  it('throws BadRequestException when clientBrand exists but has no id and status is ACCEPTED', async () => {
    const user = makeUser();
    // clientBrand.brandProfileId matches so ownership passes, but id is empty
    const campaign = makeCampaign({
      clientBrand: {
        id: '',
        brandProfileId: 'bp-1',
        agencyId: null,
        brandName: 'Acme',
        brandEmail: null,
      },
    });
    const application = makeApplication();

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.campaignApplication.findUnique.mockResolvedValue(application);

    const service = new CampaignsService(prisma, makeConvService(prisma));

    // The code checks `if (!clientBrandId)` — empty string is falsy
    await expect(
      service.updateApplicationStatus(
        'user-brand-1',
        'campaign-1',
        'app-1',
        'ACCEPTED',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// getApplications tests
// ---------------------------------------------------------------------------

describe('CampaignsService.getApplications', () => {
  // Build 3 applications: one ACCEPTED (inf-1), two PENDING (inf-2, inf-3)
  const applications = [
    {
      id: 'app-1',
      campaignId: 'campaign-1',
      influencerId: 'inf-1',
      status: 'ACCEPTED',
      influencer: {
        id: 'inf-1',
        bio: null,
        categories: [],
        user: { name: 'Alice', email: 'alice@x.com' },
        platformAccounts: [],
      },
    },
    {
      id: 'app-2',
      campaignId: 'campaign-1',
      influencerId: 'inf-2',
      status: 'PENDING',
      influencer: {
        id: 'inf-2',
        bio: null,
        categories: [],
        user: { name: 'Bob', email: 'bob@x.com' },
        platformAccounts: [],
      },
    },
    {
      id: 'app-3',
      campaignId: 'campaign-1',
      influencerId: 'inf-3',
      status: 'PENDING',
      influencer: {
        id: 'inf-3',
        bio: null,
        categories: [],
        user: { name: 'Carol', email: 'carol@x.com' },
        platformAccounts: [],
      },
    },
  ];

  // Only inf-1 has a conversation
  const conversations = [{ id: 'conv-1', influencerId: 'inf-1' }];

  function buildGetApplicationsPrisma() {
    const user = makeUser();
    const campaign = makeCampaign();

    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.campaign.findUnique.mockResolvedValue(campaign);
    prisma.conversation.findMany.mockResolvedValue(conversations);
    prisma.campaignApplication.findMany.mockResolvedValue(applications);
    return prisma;
  }

  // -----------------------------------------------------------------------
  // TC-07: conversation.findMany called exactly once (no N+1)
  // -----------------------------------------------------------------------
  it('TC-07: prisma.conversation.findMany is called exactly once regardless of application count', async () => {
    const prisma = buildGetApplicationsPrisma();
    const service = new CampaignsService(prisma, makeConvService(prisma));

    await service.getApplications('user-brand-1', 'campaign-1');

    expect(prisma.conversation.findMany).toHaveBeenCalledTimes(1);
    // campaignApplication.findMany also called once
    expect(prisma.campaignApplication.findMany).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // TC-08: ACCEPTED application (inf-1) gets the matching conversationId
  // -----------------------------------------------------------------------
  it('TC-08: application whose influencerId matches a conversation gets conversationId attached', async () => {
    const prisma = buildGetApplicationsPrisma();
    const service = new CampaignsService(prisma, makeConvService(prisma));

    const results = await service.getApplications('user-brand-1', 'campaign-1');

    const app1 = results.find((r: any) => r.id === 'app-1');
    expect(app1).toBeDefined();
    expect(app1?.conversationId).toBe('conv-1');
  });

  // -----------------------------------------------------------------------
  // TC-09: Non-matched applications get null conversationId
  // -----------------------------------------------------------------------
  it('TC-09: applications with no matching conversation get conversationId: null', async () => {
    const prisma = buildGetApplicationsPrisma();
    const service = new CampaignsService(prisma, makeConvService(prisma));

    const results = await service.getApplications('user-brand-1', 'campaign-1');

    const app2 = results.find((r: any) => r.id === 'app-2');
    const app3 = results.find((r: any) => r.id === 'app-3');

    expect(app2?.conversationId).toBeNull();
    expect(app3?.conversationId).toBeNull();
  });

  // -----------------------------------------------------------------------
  // TC-10: conversation.findMany is called with { where: { campaignId } }
  //   Ensures the single-query is scoped to the correct campaign
  // -----------------------------------------------------------------------
  it('TC-10: conversation.findMany is scoped to the correct campaignId', async () => {
    const prisma = buildGetApplicationsPrisma();
    const service = new CampaignsService(prisma, makeConvService(prisma));

    await service.getApplications('user-brand-1', 'campaign-1');

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'campaign-1' },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// FRONTEND TESTS NOTE
// ---------------------------------------------------------------------------
/*
 * React Testing Library (RTL) and Jest are NOT configured in influ-app-frontend.
 * The package.json has no jest config, no @testing-library/* dependencies,
 * and no test script. Frontend tests are documented below but NOT written as
 * runnable files to avoid polluting the repo with dead test infrastructure.
 *
 * Frontend test scenarios (to implement once RTL is set up):
 *
 * FE-01: CampaignDetailPage — accepted application with conversationId
 *   Render the applications list with one ACCEPTED app that has conversationId.
 *   Assert: "Message" button is present in the DOM.
 *   Assert: clicking "Message" calls router.push with `/messages?convId=<id>`.
 *
 * FE-02: CampaignDetailPage — accepted application WITHOUT conversationId
 *   Assert: "Message" button is NOT rendered.
 *
 * FE-03: CampaignDetailPage — updateApplication ACCEPTED path updates state
 *   Mock apiUpdateCampaignApplicationStatus to return { status: 'ACCEPTED', conversationId: 'conv-x' }.
 *   Click "Accept" button.
 *   Assert: "Message" button appears without a page reload (state update).
 *
 * FE-04: MessagesPage — convId query param selects conversation on load
 *   Provide convIdFromUrl = 'conv-1', conversations list includes conv-1.
 *   Assert: activeConvId is set to 'conv-1' on initial render.
 *
 * FE-05: MessagesPage — "View Campaign →" link is rendered when conv has campaignId
 *   Assert: Link href = `/campaigns/<campaignId>`.
 */
