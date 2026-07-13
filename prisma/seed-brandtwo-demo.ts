/**
 * Demo seed for brandtwo@test.com — populates the full share-link feature set
 * (public campaign page, shortlist share page, tracking) for ONE campaign under
 * brandtwo's clientBrand.
 *
 * Scoped strictly to:
 *   userId        c9e70757-0e96-432e-a822-50e60f57f857
 *   clientBrandId b2422526-5184-4ba7-8027-e8ab206e9860
 *
 * Safe to re-run: every write is find-or-create / upsert. No destructive delete,
 * and it never touches the existing "Test" campaign or any other account's data.
 *
 * Run:  npx ts-node -r tsconfig-paths/register prisma/seed-brandtwo-demo.ts
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const BRAND_USER_ID = 'c9e70757-0e96-432e-a822-50e60f57f857';
const CLIENT_BRAND_ID = 'b2422526-5184-4ba7-8027-e8ab206e9860';
const CAMPAIGN_NAME = 'Songkran Glow Skincare Push 2026';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

const avatar = (seed: string) =>
  `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`;

type AccountSpec = {
  platform: string;
  followers: number;
  engagementRate: number;
  // Real profile URL (source-of-truth; matches the live-DB correction). Some real
  // handles differ per platform, so each account carries its own URL + optional
  // handle override (defaults to the influencer's externalHandle).
  profileUrl: string;
  handle?: string;
};
type InfluencerSpec = {
  externalHandle: string;
  displayName: string;
  categories: string[];
  accounts: AccountSpec[];
};

const INFLUENCERS: InfluencerSpec[] = [
  {
    externalHandle: 'thamespuripat',
    displayName: 'Thames',
    categories: ['fitness', 'lifestyle'],
    accounts: [
      { platform: 'instagram', followers: 66700, engagementRate: 3.8, profileUrl: 'https://www.instagram.com/thamespuripat/' },
      { platform: 'tiktok', followers: 48000, engagementRate: 5.2, profileUrl: 'https://www.tiktok.com/@thamespuripat' },
      { platform: 'youtube', followers: 707, engagementRate: 1.5, profileUrl: 'https://www.youtube.com/channel/UCpe08UcwE164ao3zzGtawzQ' },
    ],
  },
  {
    externalHandle: 'martinbravobkk',
    displayName: 'Martin',
    categories: ['travel', 'lifestyle', 'culture'],
    accounts: [
      { platform: 'tiktok', followers: 684000, engagementRate: 6.5, profileUrl: 'https://www.tiktok.com/@martinbravobkk' },
      { platform: 'instagram', followers: 199000, engagementRate: 4.0, profileUrl: 'https://www.instagram.com/martinbravobkk/' },
      { platform: 'youtube', followers: 144000, engagementRate: 2.8, profileUrl: 'https://www.youtube.com/channel/UCVwJ3FA4WXV48qReSZDLGZQ' },
    ],
  },
  {
    externalHandle: 'riety.pahn',
    displayName: 'Pahn',
    categories: ['wellness', 'nature', 'culture', 'heritage'],
    // YouTube handle differs from the IG handle (@riety, not @riety.pahn), so it
    // carries its own handle override. Kept in the spec so the prune step no
    // longer drops it.
    accounts: [
      { platform: 'instagram', followers: 349000, engagementRate: 4.2, profileUrl: 'https://www.instagram.com/riety.pahn/' },
      { platform: 'tiktok', followers: 231000, engagementRate: 5.8, profileUrl: 'https://www.tiktok.com/@rietypahn' },
      { platform: 'youtube', followers: 720000, engagementRate: 3.5, handle: 'riety', profileUrl: 'https://www.youtube.com/@riety' },
    ],
  },
  {
    externalHandle: 'kaimookjenn',
    displayName: 'Kaimook',
    categories: ['lifestyle'],
    accounts: [
      { platform: 'instagram', followers: 262000, engagementRate: 4.5, profileUrl: 'https://www.instagram.com/kaimookjenn/' },
      // Real TikTok handle has an extra "n" (differs from the IG handle).
      { platform: 'tiktok', followers: 84200, engagementRate: 5.0, handle: 'kaimookjennn', profileUrl: 'https://www.tiktok.com/@kaimookjennn' },
      { platform: 'youtube', followers: 3560, engagementRate: 1.0, profileUrl: 'https://www.youtube.com/@kaimookjenn' },
    ],
  },
  {
    externalHandle: 'joycehysin',
    displayName: 'Joyce',
    categories: ['wellness', 'food'],
    // Instagram + TikTok only — no YouTube (stays at exactly 2 accounts).
    accounts: [
      { platform: 'instagram', followers: 189000, engagementRate: 4.1, profileUrl: 'https://www.instagram.com/joycehysin/' },
      { platform: 'tiktok', followers: 117000, engagementRate: 5.5, profileUrl: 'https://www.tiktok.com/@joycehysin' },
    ],
  },
];

/** Find-or-create an external influencer + its platform accounts by externalHandle. */
async function upsertInfluencer(spec: InfluencerSpec) {
  let inf = await prisma.influencerProfile.findFirst({
    where: { externalHandle: spec.externalHandle, isExternal: true },
    include: { platformAccounts: true },
  });
  if (!inf) {
    inf = await prisma.influencerProfile.create({
      data: {
        isExternal: true,
        externalHandle: spec.externalHandle,
        country: 'Thailand',
        categories: spec.categories,
        availabilityStatus: 'open',
      },
      include: { platformAccounts: true },
    });
  }
  // Prune any account whose platform is no longer in the spec (keeps the spec the
  // single source of truth — e.g. drops Pahn's previously-seeded YouTube on re-run).
  const specPlatforms = spec.accounts.map((a) => a.platform);
  await prisma.platformAccount.deleteMany({
    where: { influencerId: inf.id, platform: { notIn: specPlatforms } },
  });

  // Ensure each platform account exists. Matched by (influencerId, platform) only
  // — a platform is one account here, so this stays idempotent even when the real
  // handle differs from the externalHandle (avoids duplicate rows on re-run).
  const topFollowers = Math.max(...spec.accounts.map((a) => a.followers));
  for (const a of spec.accounts) {
    const handle = a.handle ?? spec.externalHandle;
    const existing = await prisma.platformAccount.findFirst({
      where: { influencerId: inf.id, platform: a.platform },
    });
    if (!existing) {
      await prisma.platformAccount.create({
        data: {
          influencerId: inf.id,
          platform: a.platform,
          handle,
          displayName: spec.displayName,
          avatarUrl: avatar(spec.externalHandle),
          profileUrl: a.profileUrl,
          followers: a.followers,
          avgViews: Math.round(a.followers * 0.15),
          engagementRate: a.engagementRate,
          isPrimary: a.followers === topFollowers,
        },
      });
    }
  }
  return inf;
}

/** Find-or-create a SubmittedContent for an application (idempotent by contentUrl). */
async function upsertSubmittedContent(
  applicationId: string,
  contentUrl: string,
  contentType: string,
) {
  const existing = await prisma.submittedContent.findFirst({
    where: { applicationId, contentUrl },
  });
  if (existing) return existing;
  return prisma.submittedContent.create({
    data: { applicationId, contentUrl, contentType, reviewStatus: 'APPROVED' },
  });
}

/** Check-before-create a share link (reuses an active, non-expired one). */
async function ensureShareLink(
  model: 'campaignShareLink' | 'campaignShortlistShareLink',
  campaignId: string,
) {
  const now = new Date();
  const client = prisma[model] as any;
  const active = await client.findFirst({
    where: {
      campaignId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (active) return active;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  return client.create({
    data: { token, campaignId, createdById: BRAND_USER_ID, expiresAt },
  });
}

async function main() {
  const counts = {
    influencersCreated: 0,
    applications: 0,
    shortlist: 0,
    trackingSnapshots: 0,
  };

  // Sanity: the clientBrand must exist and belong to brandtwo.
  const cb = await prisma.clientBrand.findUnique({
    where: { id: CLIENT_BRAND_ID },
  });
  if (!cb) throw new Error(`clientBrand ${CLIENT_BRAND_ID} not found — aborting`);

  // ── STEP A: influencers ────────────────────────────────────────────────────
  const infByHandle: Record<string, { id: string }> = {};
  for (const spec of INFLUENCERS) {
    const before = await prisma.influencerProfile.count({
      where: { externalHandle: spec.externalHandle, isExternal: true },
    });
    const inf = await upsertInfluencer(spec);
    infByHandle[spec.externalHandle] = inf;
    if (before === 0) counts.influencersCreated++;
  }

  // ── STEP B: campaign (find-or-create by clientBrandId + name) ───────────────
  let campaign = await prisma.campaign.findFirst({
    where: { clientBrandId: CLIENT_BRAND_ID, name: CAMPAIGN_NAME },
  });
  if (!campaign) {
    campaign = await prisma.campaign.create({
      data: {
        clientBrandId: CLIENT_BRAND_ID,
        name: CAMPAIGN_NAME,
        objective: 'Awareness + UGC for Songkran limited-edition sunscreen',
        budget: 350000,
        budgetSpent: 120000,
        paymentType: 'FIXED',
        visibility: 'PUBLIC',
        status: 'ACTIVE',
        coverImageUrl: 'https://picsum.photos/seed/songkran-glow-cover/1200/480',
        briefImageUrl: 'https://picsum.photos/seed/songkran-glow-brief/1000/1000',
        keyMessage:
          'Glow through Songkran. Our limited-edition SPF50+ sunscreen keeps skin ' +
          'protected and radiant through every water fight, temple visit, and rooftop ' +
          'party. Lightweight, non-greasy, and reef-safe — the festival essential.',
        doAndDont:
          "DO: Show the product in real Songkran moments (water play, outdoor sun, " +
          "day-to-night). DO: Reapply on camera to highlight the lightweight feel. " +
          "DO: Tag @glowskincare and use #SongkranGlow2026.\n" +
          "DON'T: Make medical/whitening claims. DON'T: Pair with competitor SPF. " +
          "DON'T: Film indoors only — the sun-care angle needs outdoor light.",
        deliverables:
          '1x hero video (60–90s) + 2x short-form clips per creator, published ' +
          'before Songkran (Apr 13). Include at least one reapplication shot and a ' +
          'clear product close-up. Stories/teasers encouraged in the week prior.',
        applyDeadline: new Date('2026-03-20T00:00:00Z'),
        submissionDate: new Date('2026-04-05T00:00:00Z'),
        reviewDate: new Date('2026-04-09T00:00:00Z'),
        paymentDate: new Date('2026-04-25T00:00:00Z'),
      },
    });
  }

  if (!campaign) throw new Error('campaign find-or-create failed');
  const campaignId = campaign.id;

  // One CampaignRequirement (ensure exactly one exists).
  const existingReq = await prisma.campaignRequirement.findFirst({
    where: { campaignId: campaignId },
  });
  if (!existingReq) {
    await prisma.campaignRequirement.create({
      data: {
        campaignId: campaignId,
        minFollowers: 50000,
        minEngagementRate: 3,
        platforms: ['tiktok', 'instagram', 'youtube'],
        categories: ['beauty', 'lifestyle', 'wellness'],
        locations: ['Thailand'],
      },
    });
  }

  // ── STEP C: participants (ACCEPTED applications, origin INVITATION) ──────────
  const participants = ['thamespuripat', 'martinbravobkk', 'riety.pahn'];
  const appByHandle: Record<string, { id: string }> = {};
  for (const handle of participants) {
    const inf = infByHandle[handle];
    const app = await prisma.campaignApplication.upsert({
      where: {
        campaignId_influencerId: {
          campaignId: campaignId,
          influencerId: inf.id,
        },
      },
      create: {
        campaignId: campaignId,
        influencerId: inf.id,
        status: 'ACCEPTED',
        origin: 'INVITATION',
      },
      update: {}, // leave existing status untouched on re-run
    });
    appByHandle[handle] = app;
    counts.applications++;
  }

  // ── STEP D: shortlist (all 5, upsert on campaignId+influencerId) ────────────
  const shortlist: Record<string, { price: number; note: string }> = {
    thamespuripat: {
      price: 35000,
      note:
        'Brings a fresh outdoor-exercise angle — natural fit for showing SPF in ' +
        'real use during Songkran activities.',
    },
    martinbravobkk: {
      price: 90000,
      note:
        'Cinematic, high-production travel content with the single largest reach ' +
        'on the list (684K TikTok).',
    },
    'riety.pahn': {
      price: 95000,
      note:
        'Wellness/nature/culture niche lines up directly with sun-care positioning; ' +
        'large combined footprint (349K IG, 231K TikTok).',
    },
    kaimookjenn: {
      price: 55000,
      note:
        'Broad lifestyle audience on IG (262K) — strong for everyday routine content.',
    },
    joycehysin: {
      price: 48000,
      note:
        "Wellness/food niche fits a 'Songkran get-ready' routine tie-in alongside " +
        'her usual content.',
    },
  };
  for (const [handle, { price, note }] of Object.entries(shortlist)) {
    const inf = infByHandle[handle];
    await prisma.campaignShortlist.upsert({
      where: {
        campaignId_influencerId: {
          campaignId: campaignId,
          influencerId: inf.id,
        },
      },
      create: {
        campaignId: campaignId,
        influencerId: inf.id,
        recommendationNote: note,
        proposedPrice: price,
        createdById: BRAND_USER_ID,
      },
      update: { recommendationNote: note, proposedPrice: price },
    });
    counts.shortlist++;
  }

  // ── STEP E: tracking (content + snapshots for the 3 participants) ────────────
  type Snap = {
    recordedAt: Date;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    er: number;
  };
  async function addTracking(
    handle: string,
    contentUrl: string,
    contentType: string,
    snaps: Snap[],
  ) {
    const inf = infByHandle[handle];
    const app = appByHandle[handle];
    const content = await upsertSubmittedContent(app.id, contentUrl, contentType);
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
          campaignId: campaignId,
          influencerId: inf.id,
          submittedContentId: content.id,
          snapshotPeriod: 'WEEKLY',
          views: s.views,
          likes: s.likes,
          comments: s.comments,
          shares: s.shares,
          engagementRate: s.er,
          recordedAt: s.recordedAt,
        },
        update: {
          views: s.views,
          likes: s.likes,
          comments: s.comments,
          shares: s.shares,
          engagementRate: s.er,
        },
      });
      counts.trackingSnapshots++;
    }
  }

  await addTracking(
    'thamespuripat',
    'https://tiktok.com/@thamespuripat/video/demo1',
    'video',
    [
      {
        recordedAt: new Date('2026-04-15T00:00:00Z'),
        views: 40000,
        likes: 2800,
        comments: 150,
        shares: 70,
        er: 4.9,
      },
      {
        recordedAt: new Date('2026-04-22T00:00:00Z'),
        views: 78000,
        likes: 5900,
        comments: 310,
        shares: 140,
        er: 5.3,
      },
    ],
  );

  await addTracking(
    'martinbravobkk',
    'https://tiktok.com/@martinbravobkk/video/demo1',
    'video',
    [
      {
        recordedAt: new Date('2026-04-22T00:00:00Z'),
        views: 410000,
        likes: 38000,
        comments: 1800,
        shares: 900,
        er: 6.7,
      },
    ],
  );

  await addTracking(
    'riety.pahn',
    'https://youtube.com/watch?v=demoPahn1',
    'video',
    [
      {
        recordedAt: new Date('2026-04-22T00:00:00Z'),
        views: 95000,
        likes: 6100,
        comments: 410,
        shares: 150,
        er: 3.4,
      },
    ],
  );
  await addTracking(
    'riety.pahn',
    'https://instagram.com/p/demoPahn2',
    'image',
    [
      {
        recordedAt: new Date('2026-04-22T00:00:00Z'),
        views: 42000,
        likes: 3900,
        comments: 210,
        shares: 85,
        er: 4.6,
      },
    ],
  );

  // ── STEP F: share links (check-before-create) ───────────────────────────────
  const campaignLink = await ensureShareLink('campaignShareLink', campaignId);
  const shortlistLink = await ensureShareLink(
    'campaignShortlistShareLink',
    campaignId,
  );

  const campaignUrl = `${FRONTEND_ORIGIN}/campaigns/public/${campaignLink.token}`;
  const shortlistUrl = `${FRONTEND_ORIGIN}/campaigns/public/${shortlistLink.token}/influencers`;

  console.log('\n──────────────────────────────────────────────');
  console.log('✓ brandtwo demo seed complete');
  console.log('  campaignId:            ', campaignId);
  console.log('  influencers created:   ', counts.influencersCreated, '(of 5; rest already existed)');
  console.log('  ACCEPTED applications: ', counts.applications);
  console.log('  shortlist rows:        ', counts.shortlist);
  console.log('  tracking snapshots:    ', counts.trackingSnapshots);
  console.log('──────────────────────────────────────────────');
  console.log('\nPUBLIC CAMPAIGN PAGE:\n  ' + campaignUrl);
  console.log('\nSHORTLIST SHARE PAGE:\n  ' + shortlistUrl + '\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
