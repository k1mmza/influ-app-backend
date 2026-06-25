import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Clean up any previous seed users with these emails
  for (const email of ['demo.influencer@influapp.test', 'demo.brand@influapp.test']) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.delete({ where: { id: existing.id } });
    }
  }

  const hashed = await bcrypt.hash('Test1234!', 10);

  const user = await prisma.user.create({
    data: {
      name: 'Aria Thorne',
      email: 'demo.influencer@influapp.test',
      password: hashed,
      role: 'INFLUENCER',
      isRoleSelected: true,
      influencerProfile: {
        create: {
          bio: 'Lifestyle & travel creator based in Bangkok. Collaborating with brands on authentic storytelling across YouTube, TikTok, and Instagram.',
          categories: ['lifestyle', 'travel', 'fashion'],
          styleTags: ['cinematic', 'aesthetic', 'vlog'],
          keywords: ['travel', 'thailand', 'lifestyle', 'food', 'fashion'],
          country: 'Thailand',
          performanceScore: 87,
          qualityScore: 82,
          audienceQualityScore: 79,
          growthRate: 4.2,
          availabilityStatus: 'open',
          responseRate: 94,
          avgResponseTimeHrs: 6,
          platformAccounts: {
            create: [
              // ── YouTube ──────────────────────────────────────────────────
              {
                platform: 'youtube',
                handle: 'AriaThorneVlogs',
                displayName: 'Aria Thorne Vlogs',
                avatarUrl: 'https://api.dicebear.com/9.x/thumbs/svg?seed=AriaThorneYT',
                profileUrl: 'https://youtube.com/@AriaThorneVlogs',
                followers: 284000,
                avgViews: 42000,
                engagementRate: 5.8,
                growthRate: 3.9,
                isPrimary: true,
                channelId: 'UCmock_aria_youtube_001',
                watchTimeMins: 1820000,
                avgViewDuration: 312,
                avgViewPct: 62,
                subscribersGained: 3400,
                topCountries: [
                  { country: 'Thailand', viewPct: 38 },
                  { country: 'United States', viewPct: 22 },
                  { country: 'United Kingdom', viewPct: 11 },
                  { country: 'Australia', viewPct: 8 },
                  { country: 'Singapore', viewPct: 7 },
                ],
                spotlightVideoId: 'mock_yt_v001',
                spotlightVideoTitle: '7 Days in Chiang Mai — Hidden Gems Only Locals Know',
                spotlightThumbnailUrl: 'https://picsum.photos/seed/ariayt/640/360',
                audienceInsights: {
                  create: {
                    malePct: 36,
                    femalePct: 64,
                    ageDistribution: { '18-24': 29, '25-34': 41, '35-44': 18, '45-54': 8, '55+': 4 },
                  },
                },
              },
              // ── TikTok ───────────────────────────────────────────────────
              {
                platform: 'tiktok',
                handle: '@aria.thorne',
                displayName: 'Aria Thorne',
                avatarUrl: 'https://api.dicebear.com/9.x/thumbs/svg?seed=AriaThorneTP',
                profileUrl: 'https://tiktok.com/@aria.thorne',
                followers: 510000,
                avgViews: 128000,
                engagementRate: 9.4,
                growthRate: 11.2,
                isPrimary: false,
                channelId: 'mock_aria_tiktok_001',
                spotlightVideoId: 'mock_tt_v001',
                spotlightVideoTitle: 'Street food I found at 2 AM in Bangkok 🍜',
                spotlightThumbnailUrl: 'https://picsum.photos/seed/ariatt/640/360',
                audienceInsights: {
                  create: {
                    malePct: 28,
                    femalePct: 72,
                    ageDistribution: { '13-17': 8, '18-24': 44, '25-34': 32, '35-44': 12, '45+': 4 },
                  },
                },
              },
              // ── Instagram ────────────────────────────────────────────────
              {
                platform: 'instagram',
                handle: 'aria.thorne',
                displayName: 'Aria Thorne ✈️',
                avatarUrl: 'https://api.dicebear.com/9.x/thumbs/svg?seed=AriaThorneIG',
                profileUrl: 'https://instagram.com/aria.thorne',
                followers: 196000,
                avgViews: 31000,
                engagementRate: 6.1,
                growthRate: 2.7,
                isPrimary: false,
                channelId: 'mock_aria_ig_001',
                spotlightVideoId: 'mock_ig_v001',
                spotlightVideoTitle: 'Golden hour Santorini reel',
                spotlightThumbnailUrl: 'https://picsum.photos/seed/ariaig/640/360',
                audienceInsights: {
                  create: {
                    malePct: 31,
                    femalePct: 69,
                    ageDistribution: { '18-24': 35, '25-34': 38, '35-44': 17, '45-54': 7, '55+': 3 },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });

  console.log(`✓ Created influencer: ${user.name} (${user.email})`);
  console.log(`  Platforms: YouTube 284k · TikTok 510k · Instagram 196k`);

  const influencerProfile = await prisma.influencerProfile.findUniqueOrThrow({
    where: { userId: user.id },
  });

  // ── Brand + campaign + tracking data (so /tracking has real rows) ──────────
  const hashedBrand = await bcrypt.hash('Test1234!', 10);
  const brand = await prisma.user.create({
    data: {
      name: 'Lumen Skincare',
      email: 'demo.brand@influapp.test',
      password: hashedBrand,
      role: 'BRAND',
      isRoleSelected: true,
      brandProfile: {
        create: { companyName: 'Lumen Skincare', websiteUrl: 'https://lumen.example' },
      },
    },
    include: { brandProfile: true },
  });

  const clientBrand = await prisma.clientBrand.create({
    data: {
      brandProfileId: brand.brandProfile!.id,
      brandName: 'Lumen Skincare',
      brandEmail: brand.email,
      isRegistered: true,
    },
  });

  const campaign = await prisma.campaign.create({
    data: {
      clientBrandId: clientBrand.id,
      name: 'Summer Skincare Launch',
      objective: 'Awareness',
      budget: 240000,
      budgetSpent: 98000,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
    },
  });

  const application = await prisma.campaignApplication.create({
    data: { campaignId: campaign.id, influencerId: influencerProfile.id, status: 'ACCEPTED' },
  });

  // Two pieces of submitted content; the TikTok one gets two snapshots over time
  // so the latest-snapshot-wins dedup path is exercised on the page.
  const tiktokContent = await prisma.submittedContent.create({
    data: {
      applicationId: application.id,
      contentUrl: 'https://tiktok.com/@aria.thorne/video/mock1',
      contentType: 'video',
      reviewStatus: 'APPROVED',
    },
  });
  const igContent = await prisma.submittedContent.create({
    data: {
      applicationId: application.id,
      contentUrl: 'https://instagram.com/p/mock2',
      contentType: 'image',
      reviewStatus: 'APPROVED',
    },
  });

  await prisma.trackingResult.createMany({
    data: [
      // older snapshot for the TikTok post — should be hidden by the newer one
      {
        campaignId: campaign.id, influencerId: influencerProfile.id, submittedContentId: tiktokContent.id,
        snapshotPeriod: 'WEEKLY', views: 96000, likes: 7100, comments: 320, shares: 180,
        engagementRate: 4.2, recordedAt: new Date('2026-06-10'),
      },
      // latest snapshot for the TikTok post
      {
        campaignId: campaign.id, influencerId: influencerProfile.id, submittedContentId: tiktokContent.id,
        snapshotPeriod: 'WEEKLY', views: 182000, likes: 12400, comments: 640, shares: 312,
        engagementRate: 5.2, recordedAt: new Date('2026-06-20'),
      },
      // single snapshot for the IG post
      {
        campaignId: campaign.id, influencerId: influencerProfile.id, submittedContentId: igContent.id,
        snapshotPeriod: 'WEEKLY', views: 72000, likes: 4800, comments: 180, shares: 95,
        engagementRate: 4.5, recordedAt: new Date('2026-06-20'),
      },
    ],
  });

  console.log(`✓ Created brand: ${brand.name} (${brand.email})`);
  console.log(`  Campaign "${campaign.name}" with 2 tracked posts (3 snapshots)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
