import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Clean up any previous seed user with this email
  const existing = await prisma.user.findUnique({ where: { email: 'demo.influencer@influapp.test' } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
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
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
