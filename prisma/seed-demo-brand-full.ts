/**
 * Full-coverage demo seed for demo.brand@influapp.test ("Lumen Skincare") —
 * populates every section of the brand dashboard (Active Campaigns, Needs
 * Your Attention, Campaign Performance, Budget & Payments, Recent Activity)
 * plus 3 campaigns, 3 messaging conversations (one per phase), and tracking
 * data, so the whole app can be reviewed end-to-end from one account.
 *
 * Login:  demo.brand@influapp.test / Test1234!
 * (Same credentials as the base prisma/seed.ts — this script builds on top
 * of that account's existing ClientBrand + first campaign + Aria Thorne.)
 *
 * Safe to re-run: every write is find-or-create / upsert scoped to fixed IDs
 * and unique keys below. No destructive delete.
 *
 * Run:  npx ts-node -r tsconfig-paths/register prisma/seed-demo-brand-full.ts
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BRAND_USER_ID = '0d6e5d27-2593-4621-b54f-b2d90831582a';
const CLIENT_BRAND_ID = 'fe44573d-479d-458a-b3ff-9a66a55ce6e6';
const CAMPAIGN_A_ID = '720ccee3-3ffc-41be-90a7-f47798bb5d97'; // Summer Skincare Launch (pre-existing)
const DEMO_PASSWORD = 'Test1234!';

const avatar = (seed: string) =>
  `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`;

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function main() {
  console.log('── Seeding full demo data for demo.brand@influapp.test ──');

  // ── STEP A: enrich Campaign A (Summer Skincare Launch) with full fields ──
  const campaignA = await prisma.campaign.update({
    where: { id: CAMPAIGN_A_ID },
    data: {
      objective: 'Awareness + UGC for the Summer Skincare line',
      paymentType: 'FIXED',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      coverImageUrl: 'https://picsum.photos/seed/summer-skincare-cover/1200/480',
      briefImageUrl: 'https://picsum.photos/seed/summer-skincare-brief/1000/1000',
      keyMessage:
        'Beat the heat with Lumen. Our lightweight summer serum keeps skin ' +
        'hydrated without the greasy feel — show it fitting into a real daily ' +
        'routine, from morning prep to after-sun care.',
      doAndDont:
        'DO: Show real application on clean, dry skin. DO: Mention the ' +
        'oil-free finish. DO: Tag @lumenskincare and use #LumenGlow.\n' +
        "DON'T: Pair with competitor skincare on camera. DON'T: Make " +
        "medical claims about acne/sun damage. DON'T: Film in low light — " +
        'the product finish needs to read clearly on camera.',
      deliverables:
        '1x hero video (45–60s) + 2x short-form clips. Include a clear ' +
        'before/after application shot. Stories teaser encouraged the week ' +
        'of launch.',
      applyDeadline: days(-30),
      submissionDate: days(-10),
      reviewDate: days(-5),
      paymentDate: days(2),
    },
  });

  const campaignB = await prisma.campaign.upsert({
    where: { id: 'a1b2c3d4-0000-4000-8000-000000000b02' },
    create: {
      id: 'a1b2c3d4-0000-4000-8000-000000000b02',
      clientBrandId: CLIENT_BRAND_ID,
      name: 'Radiant Nights Serum Drop',
      objective: 'Launch buzz + reviews for the new night repair serum',
      budget: 180000,
      budgetSpent: 50000,
      paymentType: 'FIXED',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      coverImageUrl: 'https://picsum.photos/seed/radiant-nights-cover/1200/480',
      briefImageUrl: 'https://picsum.photos/seed/radiant-nights-brief/1000/1000',
      keyMessage:
        'Wake up radiant. Our new night repair serum works while you sleep — ' +
        'show your real nighttime routine and the morning glow payoff.',
      doAndDont:
        'DO: Film both the nighttime application and the next-morning result. ' +
        "DO: Highlight the non-sticky texture. DON'T: Use heavy filters on " +
        "the morning shot — the glow should read as real. DON'T: Compare " +
        'directly against a named competitor product.',
      deliverables:
        '1x night-routine + morning-result video (60–90s) + 1x static carousel ' +
        'post with 3 close-up product shots.',
      applyDeadline: days(-13),
      submissionDate: days(2),
      reviewDate: days(5),
      paymentDate: days(13),
    },
    update: {},
  });

  const campaignC = await prisma.campaign.upsert({
    where: { id: 'a1b2c3d4-0000-4000-8000-000000000c03' },
    create: {
      id: 'a1b2c3d4-0000-4000-8000-000000000c03',
      clientBrandId: CLIENT_BRAND_ID,
      name: 'Glow Getters Referral Push',
      objective: 'Community-driven referral campaign ahead of Q3 restock',
      budget: 150000,
      budgetSpent: 0,
      paymentType: 'FIXED',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      coverImageUrl: 'https://picsum.photos/seed/glow-getters-cover/1200/480',
      briefImageUrl: 'https://picsum.photos/seed/glow-getters-brief/1000/1000',
      keyMessage:
        'Turn your community into Glow Getters. Share your personal Lumen ' +
        'routine and your unique referral code so followers get a launch ' +
        'discount when they try it themselves.',
      doAndDont:
        'DO: Share your own before/after journey with the product. DO: ' +
        "Clearly call out the referral code on-screen. DON'T: Promise " +
        "specific results/timelines. DON'T: Post without the required " +
        'affiliate disclosure tag.',
      deliverables:
        '1x routine/story video (30–45s) + ongoing Stories mentions through ' +
        'the campaign window, each with the referral code overlay.',
      applyDeadline: days(9),
      submissionDate: days(23),
      reviewDate: days(26),
      paymentDate: days(33),
    },
    update: {},
  });

  const campaigns = { A: campaignA, B: campaignB, C: campaignC };
  console.log('✓ campaigns ready:', Object.values(campaigns).map((c) => c.name).join(', '));

  // One CampaignRequirement per campaign.
  const requirementSpecs: Record<'A' | 'B' | 'C', any> = {
    A: { minFollowers: 50000, minEngagementRate: 3, platforms: ['tiktok', 'instagram'], categories: ['beauty', 'skincare'], locations: ['Thailand'] },
    B: { minFollowers: 60000, minEngagementRate: 3.5, platforms: ['tiktok', 'instagram'], categories: ['beauty', 'skincare'], locations: ['Thailand'] },
    C: { minFollowers: 40000, minEngagementRate: 3, platforms: ['tiktok', 'instagram', 'youtube'], categories: ['beauty', 'lifestyle'], locations: ['Thailand'] },
  };
  for (const key of ['A', 'B', 'C'] as const) {
    const campaign = campaigns[key];
    const existing = await prisma.campaignRequirement.findFirst({ where: { campaignId: campaign.id } });
    if (!existing) {
      await prisma.campaignRequirement.create({ data: { campaignId: campaign.id, ...requirementSpecs[key] } });
    }
  }

  // ── STEP B: influencers ──────────────────────────────────────────────────
  // #1 Aria Thorne already exists (from prisma/seed.ts) — just look her up.
  const ariaUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'demo.influencer@influapp.test' },
    include: { influencerProfile: true },
  });
  const aria = ariaUser.influencerProfile!;

  // #2 Kanya Sirisak — new real account (beauty/skincare creator).
  async function upsertInfluencerUser(spec: {
    email: string;
    name: string;
    bio: string;
    categories: string[];
    accounts: Array<{
      platform: string;
      handle: string;
      displayName: string;
      followers: number;
      avgViews: number;
      engagementRate: number;
      isPrimary?: boolean;
    }>;
  }) {
    let user = await prisma.user.findUnique({
      where: { email: spec.email },
      include: { influencerProfile: { include: { platformAccounts: true } } },
    });
    if (!user) {
      const hashed = await bcrypt.hash(DEMO_PASSWORD, 10);
      user = await prisma.user.create({
        data: {
          name: spec.name,
          email: spec.email,
          password: hashed,
          role: 'INFLUENCER',
          isRoleSelected: true,
          avatarUrl: avatar(spec.email),
          influencerProfile: {
            create: {
              bio: spec.bio,
              categories: spec.categories,
              country: 'Thailand',
              availabilityStatus: 'open',
              responseRate: 90,
              avgResponseTimeHrs: 8,
              platformAccounts: {
                create: spec.accounts.map((a) => ({
                  platform: a.platform,
                  handle: a.handle,
                  displayName: a.displayName,
                  avatarUrl: avatar(spec.email + a.platform),
                  profileUrl: `https://${a.platform === 'instagram' ? 'instagram.com' : a.platform === 'tiktok' ? 'tiktok.com/@' : 'youtube.com/@'}${a.handle}`,
                  followers: a.followers,
                  avgViews: a.avgViews,
                  engagementRate: a.engagementRate,
                  isPrimary: a.isPrimary ?? false,
                })),
              },
            },
          },
        },
        include: { influencerProfile: { include: { platformAccounts: true } } },
      });
    }
    return user.influencerProfile!;
  }

  const kanya = await upsertInfluencerUser({
    email: 'kanya.demo@influapp.test',
    name: 'Kanya Sirisak',
    bio: 'Bangkok-based skincare & beauty creator. Honest routine breakdowns and product reviews for oily/combination skin.',
    categories: ['beauty', 'skincare'],
    accounts: [
      { platform: 'instagram', handle: 'kanya.sirisak', displayName: 'Kanya Sirisak', followers: 154000, avgViews: 22000, engagementRate: 4.6, isPrimary: true },
      { platform: 'tiktok', handle: 'kanya.sirisak', displayName: 'Kanya Sirisak', followers: 92000, avgViews: 31000, engagementRate: 6.1 },
    ],
  });

  const nate = await upsertInfluencerUser({
    email: 'nate.demo@influapp.test',
    name: 'Nate Photchara',
    bio: "Men's grooming and lifestyle creator sharing no-fuss routines for busy guys.",
    categories: ['beauty', 'lifestyle', 'grooming'],
    accounts: [
      { platform: 'tiktok', handle: 'nate.photchara', displayName: 'Nate Photchara', followers: 121000, avgViews: 28000, engagementRate: 5.4, isPrimary: true },
      { platform: 'youtube', handle: 'natephotchara', displayName: 'Nate Photchara', followers: 58000, avgViews: 9000, engagementRate: 2.9 },
    ],
  });

  // #4 Praew — organic applicant only (external, no account) — feeds the
  // "applications to review" attention item on Campaign C.
  let praew = await prisma.influencerProfile.findFirst({
    where: { externalHandle: 'praew.glowup', isExternal: true },
  });
  if (!praew) {
    praew = await prisma.influencerProfile.create({
      data: {
        isExternal: true,
        externalHandle: 'praew.glowup',
        country: 'Thailand',
        categories: ['beauty', 'lifestyle'],
        availabilityStatus: 'open',
        platformAccounts: {
          create: [
            {
              platform: 'instagram',
              handle: 'praew.glowup',
              displayName: 'Praew',
              avatarUrl: avatar('praew.glowup'),
              profileUrl: 'https://instagram.com/praew.glowup',
              followers: 48000,
              avgViews: 6000,
              engagementRate: 4.1,
              isPrimary: true,
            },
          ],
        },
      },
    });
  }

  console.log('✓ influencers ready: Aria Thorne, Kanya Sirisak, Nate Photchara, Praew (applicant)');

  // ── STEP C: applications ─────────────────────────────────────────────────
  // Aria → Campaign A already ACCEPTED from base seed.ts — leave untouched.
  const appKanya = await prisma.campaignApplication.upsert({
    where: { campaignId_influencerId: { campaignId: campaignB.id, influencerId: kanya.id } },
    create: { campaignId: campaignB.id, influencerId: kanya.id, status: 'ACCEPTED', origin: 'INVITATION' },
    update: {},
  });
  const appNate = await prisma.campaignApplication.upsert({
    where: { campaignId_influencerId: { campaignId: campaignC.id, influencerId: nate.id } },
    create: { campaignId: campaignC.id, influencerId: nate.id, status: 'ACCEPTED', origin: 'INVITATION' },
    update: {},
  });
  // Praew applied organically and is still PENDING brand review.
  await prisma.campaignApplication.upsert({
    where: { campaignId_influencerId: { campaignId: campaignC.id, influencerId: praew.id } },
    create: { campaignId: campaignC.id, influencerId: praew.id, status: 'PENDING', origin: 'APPLICATION' },
    update: {},
  });

  const ariaApp = await prisma.campaignApplication.findFirstOrThrow({
    where: { campaignId: campaignA.id, influencerId: aria.id },
  });

  // ── STEP D: conversations — one per phase (payment / draft / brief) ─────
  async function ensureConversation(
    influencerId: string,
    campaignId: string,
    phase: { workPhase: string; brandPhaseReady: boolean; influencerPhaseReady: boolean },
  ) {
    const existing = await prisma.conversation.findFirst({
      where: { influencerId, clientBrandId: CLIENT_BRAND_ID, campaignId },
    });
    if (existing) {
      return prisma.conversation.update({ where: { id: existing.id }, data: phase });
    }
    return prisma.conversation.create({
      data: { influencerId, clientBrandId: CLIENT_BRAND_ID, campaignId, ...phase },
    });
  }

  const convAria = await ensureConversation(aria.id, campaignA.id, {
    workPhase: 'payment',
    brandPhaseReady: false,
    influencerPhaseReady: false,
  });
  const convKanya = await ensureConversation(kanya.id, campaignB.id, {
    workPhase: 'draft',
    brandPhaseReady: false,
    influencerPhaseReady: true,
  });
  const convNate = await ensureConversation(nate.id, campaignC.id, {
    workPhase: 'brief',
    brandPhaseReady: false,
    influencerPhaseReady: false,
  });

  console.log('✓ conversations ready: payment (Aria) / draft (Kanya) / brief (Nate)');

  // ── STEP E: messages (only seed once per conversation — skip if present) ─
  async function seedMessages(
    conversationId: string,
    influencerUserId: string,
    lines: Array<{ from: 'brand' | 'influencer'; text: string; at: Date; unread?: boolean }>,
  ) {
    const count = await prisma.message.count({ where: { conversationId } });
    if (count > 0) return;
    for (const line of lines) {
      await prisma.message.create({
        data: {
          conversationId,
          senderId: line.from === 'brand' ? BRAND_USER_ID : influencerUserId,
          content: line.text,
          sentAt: line.at,
          isRead: !line.unread,
        },
      });
    }
  }

  await seedMessages(convAria.id, ariaUser.id, [
    { from: 'brand', text: 'Hi Aria! Excited to kick off Summer Skincare Launch 🎉', at: days(-9) },
    { from: 'influencer', text: 'Thank you! Just got the brief, looks great — starting to plan the shoot.', at: days(-9) },
    { from: 'brand', text: 'Awesome, go ahead and post whenever it is ready.', at: days(-6) },
    { from: 'influencer', text: 'Just published the TikTok video, let me know what you think!', at: days(-5) },
    { from: 'brand', text: 'Loved it! Sending payment over now.', at: days(-1) },
    { from: 'brand', text: 'Payment proof uploaded — let me know once you have received it.', at: days(0) },
    { from: 'influencer', text: 'Got it, checking my bank now, thank you!', at: days(0), unread: true },
  ]);

  await seedMessages(convKanya.id, kanya.userId!, [
    { from: 'brand', text: 'Hi Kanya, welcome to Radiant Nights Serum Drop!', at: days(-12) },
    { from: 'influencer', text: 'Thanks for having me, can’t wait to create for this one.', at: days(-12) },
    { from: 'brand', text: 'Here’s the brief — check the Brief tab for the full breakdown.', at: days(-10) },
    { from: 'influencer', text: 'Filmed the night routine + morning result last night.', at: days(-1) },
    { from: 'influencer', text: 'Draft is up in the Draft tab, ready for your review!', at: days(0), unread: true },
  ]);

  await seedMessages(convNate.id, nate.userId!, [
    { from: 'brand', text: 'Hi Nate! Thanks for accepting our invite to Glow Getters Referral Push.', at: days(-3) },
    { from: 'influencer', text: 'Excited to be onboard! When can we align on the brief details?', at: days(-3) },
    { from: 'brand', text: 'Sending the full brief over now — take a look at the Brief tab.', at: days(-1) },
    { from: 'influencer', text: 'Sounds good, will review today and get back to you.', at: days(0), unread: true },
  ]);

  console.log('✓ message threads seeded (skipped for any conversation that already has messages)');

  // ── STEP F: draft awaiting review (Kanya, draft phase) ───────────────────
  const draftTitle = 'Radiant Nights — Serum Reveal Video';
  const existingDraft = await prisma.draft.findFirst({
    where: { conversationId: convKanya.id, title: draftTitle },
  });
  if (!existingDraft) {
    await prisma.draft.create({
      data: {
        conversationId: convKanya.id,
        title: draftTitle,
        status: 'SUBMITTED',
        notes: 'Night routine + next-morning glow reveal. Let me know if you want a tighter cut on the intro.',
        linkUrl: 'https://drive.google.com/demo-radiant-nights-draft',
        contentType: 'video',
      },
    });
  }

  // ── STEP G: payments ──────────────────────────────────────────────────────
  async function ensurePayment(spec: {
    campaignId: string;
    influencerId: string;
    amount: number;
    status: string;
    confirmedAt?: Date;
    paidAt?: Date;
  }) {
    const existing = await prisma.payment.findFirst({
      where: { campaignId: spec.campaignId, influencerId: spec.influencerId, amount: spec.amount },
    });
    if (existing) return existing;
    return prisma.payment.create({
      data: {
        campaignId: spec.campaignId,
        clientBrandId: CLIENT_BRAND_ID,
        influencerId: spec.influencerId,
        amount: spec.amount,
        paymentType: 'FIXED',
        status: spec.status,
        confirmedAt: spec.confirmedAt,
        paidAt: spec.paidAt,
      },
    });
  }

  await ensurePayment({
    campaignId: campaignA.id,
    influencerId: aria.id,
    amount: 45000,
    status: 'PAID',
    confirmedAt: days(-2),
    paidAt: days(-2),
  });
  await ensurePayment({
    campaignId: campaignA.id,
    influencerId: aria.id,
    amount: 60000,
    status: 'AWAITING_CONFIRMATION',
  });
  await ensurePayment({
    campaignId: campaignB.id,
    influencerId: kanya.id,
    amount: 50000,
    status: 'PENDING',
  });

  // Reflect the confirmed payment in Aria's wallet (mirrors PaymentsService.confirm).
  await prisma.wallet.upsert({
    where: { userId: ariaUser.id },
    create: { userId: ariaUser.id, totalEarned: 45000, lastPaymentAmount: 45000, lastPaymentAt: days(-2) },
    update: { totalEarned: 45000, lastPaymentAmount: 45000, lastPaymentAt: days(-2) },
  });

  console.log('✓ payments ready: 1 PAID, 1 AWAITING_CONFIRMATION, 1 PENDING');

  // ── STEP H: tracking data for all 3 campaigns / 3 influencers ────────────
  async function upsertSubmittedContent(applicationId: string, contentUrl: string, contentType: string) {
    const existing = await prisma.submittedContent.findFirst({ where: { applicationId, contentUrl } });
    if (existing) return existing;
    return prisma.submittedContent.create({
      data: { applicationId, contentUrl, contentType, reviewStatus: 'APPROVED' },
    });
  }

  async function addTracking(
    campaignId: string,
    influencerId: string,
    applicationId: string,
    contentUrl: string,
    contentType: string,
    snaps: Array<{ recordedAt: Date; views: number; likes: number; comments: number; shares: number; er: number }>,
  ) {
    const content = await upsertSubmittedContent(applicationId, contentUrl, contentType);
    for (const s of snaps) {
      await prisma.trackingResult.upsert({
        where: {
          submittedContentId_recordedAt_snapshotPeriod: {
            submittedContentId: content.id,
            recordedAt: s.recordedAt,
            snapshotPeriod: 'WEEKLY',
          },
        },
        create: {
          campaignId,
          influencerId,
          submittedContentId: content.id,
          snapshotPeriod: 'WEEKLY',
          views: s.views,
          likes: s.likes,
          comments: s.comments,
          shares: s.shares,
          engagementRate: s.er,
          recordedAt: s.recordedAt,
        },
        update: { views: s.views, likes: s.likes, comments: s.comments, shares: s.shares, engagementRate: s.er },
      });
    }
  }

  // Aria / Campaign A already has 2 pieces of tracked content from base seed.ts — left untouched.

  // Kanya / Campaign B — an earlier teaser post already live + tracked, while
  // the hero video (above) is still a Draft awaiting review.
  await addTracking(
    campaignB.id,
    kanya.id,
    appKanya.id,
    'https://www.tiktok.com/@kanya.sirisak/video/radiant-teaser1',
    'video',
    [
      { recordedAt: days(-9), views: 38000, likes: 3100, comments: 140, shares: 60, er: 5.3 },
      { recordedAt: days(-2), views: 71000, likes: 5900, comments: 290, shares: 130, er: 5.9 },
    ],
  );

  // Nate / Campaign C — an early announcement teaser, tracked, ahead of the
  // full brief content.
  await addTracking(
    campaignC.id,
    nate.id,
    appNate.id,
    'https://www.tiktok.com/@nate.photchara/video/glowgetters-teaser1',
    'video',
    [{ recordedAt: days(-2), views: 22000, likes: 1800, comments: 90, shares: 45, er: 4.8 }],
  );

  console.log('✓ tracking data ready for all 3 campaigns / 3 influencers');

  // ── STEP I: recent activity (Notification rows for the brand user) ───────
  async function ensureNotification(spec: { type: string; title: string; body: string; referenceId?: string; createdAt: Date; isRead: boolean }) {
    const existing = await prisma.notification.findFirst({
      where: { userId: BRAND_USER_ID, title: spec.title, referenceId: spec.referenceId },
    });
    if (existing) return existing;
    return prisma.notification.create({
      data: {
        userId: BRAND_USER_ID,
        type: spec.type,
        title: spec.title,
        body: spec.body,
        referenceId: spec.referenceId,
        createdAt: spec.createdAt,
        isRead: spec.isRead,
      },
    });
  }

  await ensureNotification({
    type: 'NEW_APPLICATION',
    title: 'New application received',
    body: 'Praew applied to "Glow Getters Referral Push".',
    referenceId: campaignC.id,
    createdAt: days(0),
    isRead: false,
  });
  await ensureNotification({
    type: 'DRAFT_SUBMITTED',
    title: 'New draft submitted',
    body: 'Kanya Sirisak submitted "Radiant Nights — Serum Reveal Video" for review.',
    referenceId: convKanya.id,
    createdAt: days(0),
    isRead: false,
  });
  await ensureNotification({
    type: 'PAYMENT_PROOF_UPLOADED',
    title: 'Payment proof uploaded',
    body: 'Awaiting Aria Thorne’s confirmation for the THB 60,000 payment on Summer Skincare Launch.',
    referenceId: convAria.id,
    createdAt: days(0),
    isRead: false,
  });
  await ensureNotification({
    type: 'CAMPAIGN_ACCEPTED',
    title: 'Creator accepted your invitation',
    body: 'Nate Photchara accepted your invitation to "Glow Getters Referral Push".',
    referenceId: campaignC.id,
    createdAt: days(-3),
    isRead: true,
  });
  await ensureNotification({
    type: 'PAYMENT_CONFIRMED',
    title: 'Payment confirmed',
    body: 'Aria Thorne confirmed receipt of THB 45,000 for Summer Skincare Launch.',
    referenceId: convAria.id,
    createdAt: days(-2),
    isRead: true,
  });

  console.log('✓ recent activity notifications ready');

  console.log('\n──────────────────────────────────────────────');
  console.log('✓ demo brand seed complete');
  console.log('  login: demo.brand@influapp.test / Test1234!');
  console.log('  campaigns: Summer Skincare Launch (payment phase, Aria)');
  console.log('             Radiant Nights Serum Drop (draft phase, Kanya)');
  console.log('             Glow Getters Referral Push (brief phase, Nate + 1 pending applicant)');
  console.log('  also logins: kanya.demo@influapp.test / Test1234!');
  console.log('               nate.demo@influapp.test / Test1234!');
  console.log('──────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
