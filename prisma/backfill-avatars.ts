/**
 * One-time manual backfill: replace the DiceBear placeholder avatars of the 5
 * real KOL influencers with their real Instagram profile photos, re-hosted on
 * Supabase Storage (public-assets bucket) via the existing StorageService.
 *
 * NOT wired into any queue or cron — run by hand.
 *
 * ⚠️  RESEED CAVEAT: the KOL rows come from prisma/seed-brandtwo-demo.ts, which
 *     sets their avatars to DiceBear placeholders. Re-running that seed (or any
 *     full reseed) OVERWRITES these real photos back to placeholders — re-run
 *     this script after any reseed.
 *
 * 🔒 SCOPE IS PERMANENT: only the 5 REAL handles below. Never add the fictional
 *     demo personas (Aria Thorne / Nate Photchara / Kanya Sirisak / Praew).
 *     Their handles are fabricated, and a made-up handle can resolve to an
 *     unrelated real person's actual photo — that is never acceptable here.
 *
 * Usage:
 *   Dry run (default — no Apify calls, no Supabase uploads, no DB writes):
 *     npx ts-node -r tsconfig-paths/register prisma/backfill-avatars.ts
 *   Live:
 *     npx ts-node -r tsconfig-paths/register prisma/backfill-avatars.ts --live
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { InstagramAdapter } from '../src/sync/adapters/instagram.adapter';
import { StorageService } from '../src/storage/storage.service';

// The only handles this script may ever touch. Real Thai KOLs from the proposal.
const KOL_HANDLES = [
  'thamespuripat',
  'martinbravobkk',
  'riety.pahn',
  'kaimookjenn',
  'joycehysin',
];

// Only placeholders get replaced. A row whose avatarUrl doesn't contain this is
// a real photo (data: URL, yt3.ggpht, a prior backfill) and is left untouched.
const DICEBEAR = 'api.dicebear.com';

const LIVE = process.argv.includes('--live');

const prisma = new PrismaClient();
const instagram = new InstagramAdapter();
const storage = new StorageService();

function extFromContentType(ct: string): string {
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'jpg';
}

type PlanItem = {
  handle: string;
  profileId: string;
  igHandle: string;
  placeholderPlatforms: string[];
};

async function main() {
  console.log(`\n=== KOL avatar backfill — ${LIVE ? 'LIVE' : 'DRY RUN'} ===\n`);

  const profiles = await prisma.influencerProfile.findMany({
    where: { externalHandle: { in: KOL_HANDLES } },
    include: { platformAccounts: true },
  });

  const found = new Set(profiles.map((p) => p.externalHandle));
  for (const h of KOL_HANDLES) {
    if (!found.has(h)) console.warn(`⚠️  ${h}: not found in DB — skipping`);
  }

  const plan: PlanItem[] = [];
  for (const p of profiles) {
    const placeholderRows = p.platformAccounts.filter((a) =>
      a.avatarUrl?.includes(DICEBEAR),
    );
    const ig = p.platformAccounts.find(
      (a) => a.platform.toLowerCase() === 'instagram',
    );

    if (placeholderRows.length === 0) {
      console.log(
        `• ${p.externalHandle}: no DiceBear rows — already backfilled, skipping`,
      );
      continue;
    }
    if (!ig) {
      console.log(
        `• ${p.externalHandle}: no Instagram account — skipping (IG-only sourcing)`,
      );
      continue;
    }
    plan.push({
      handle: p.externalHandle!,
      profileId: p.id,
      igHandle: ig.handle.replace(/^@/, ''),
      placeholderPlatforms: placeholderRows.map((r) => r.platform),
    });
  }

  console.log('\n--- Plan ---');
  for (const item of plan) {
    console.log(
      `• ${item.handle} (profile ${item.profileId.slice(0, 8)}) — source IG @${item.igHandle} → update ${item.placeholderPlatforms.length} placeholder row(s): ${item.placeholderPlatforms.join(', ')}`,
    );
  }
  console.log(`\nInstagram Apify runs that WILL execute (live): ${plan.length}`);

  if (!LIVE) {
    console.log(
      '\nDRY RUN — no Apify calls, no Supabase uploads, no DB writes.\nRe-run with --live to execute.\n',
    );
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of plan) {
    try {
      console.log(`\n→ ${item.handle}: fetching IG @${item.igHandle} via Apify…`);
      const profile = await instagram.fetchProfile(item.igHandle);
      if (!profile?.avatarUrl) {
        console.warn(`  ✗ Apify returned no avatar — skipping (left as placeholder)`);
        skipped++;
        continue;
      }

      const res = await fetch(profile.avatarUrl, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`  ✗ avatar download HTTP ${res.status} — skipping`);
        failed++;
        continue;
      }
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      if (!contentType.startsWith('image')) {
        console.warn(`  ✗ non-image content-type "${contentType}" — skipping`);
        failed++;
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = extFromContentType(contentType);
      const objectPath = `influencer-avatars/${item.profileId}-instagram-${Date.now()}.${ext}`;

      const publicUrl = await storage.uploadPublic(objectPath, buffer, contentType);
      console.log(
        `  ↑ uploaded ${(buffer.length / 1024).toFixed(0)}KB → ${publicUrl}`,
      );

      // Apply the one photo to every placeholder row of this influencer, so all
      // platform tabs show the same picture. Guarded on the DiceBear pattern so
      // a real photo is never clobbered even if the plan is stale.
      const upd = await prisma.platformAccount.updateMany({
        where: {
          influencerId: item.profileId,
          avatarUrl: { contains: DICEBEAR },
        },
        data: { avatarUrl: publicUrl },
      });
      console.log(`  ✓ updated ${upd.count} platform row(s)`);
      ok++;
    } catch (err: any) {
      console.error(`  ✗ ${item.handle} failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done: ${ok} ok, ${skipped} skipped, ${failed} failed ===\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
