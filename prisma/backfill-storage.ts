/**
 * ONE-TIME backfill: migrate legacy local-disk uploads (served from UPLOAD_BASE_DIR
 * at /uploads/...) into Supabase Storage, and rewrite the DB values that point at them.
 *
 *   npx ts-node -r tsconfig-paths/register prisma/backfill-storage.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register prisma/backfill-storage.ts
 *
 * DO NOT run automatically. Review the --dry-run output first.
 *
 * Behaviour:
 *  - Public folders (avatars, campaign-covers, brief-images) → public-assets bucket;
 *    the DB field is rewritten to the absolute public URL.
 *  - Private folders (rate-cards, conversations/*) → private-files bucket; the DB
 *    field is rewritten to the bucket-relative storage path (signed at read time).
 *  - conversations/ is fanned out to the right prefix by looking up which Prisma
 *    field references each file.
 *  - Idempotent: a file whose legacy `/uploads/...` value is no longer in the DB but
 *    whose target object already exists in the bucket is treated as already-migrated
 *    and skipped. A file with no legacy reference and no target object is reported as
 *    an existing ORPHAN and left alone (never uploaded).
 *
 * NOTE: the orphan report is only authoritative on the FIRST (pre-migration) run —
 * after DB values are rewritten, re-runs can no longer distinguish migrated vs orphan
 * except via the bucket-existence check above (which they do).
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const BASE = process.env.UPLOAD_BASE_DIR || './uploads';
const PUBLIC_BUCKET = 'public-assets';
const PRIVATE_BUCKET = 'private-files';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const prisma = new PrismaClient();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

type Visibility = 'public' | 'private';
type Target = {
  model: 'user' | 'campaign' | 'influencerProfile' | 'conversation' | 'payment' | 'draft';
  field: string;
  prefix: string;
  visibility: Visibility;
};

// disk folder under UPLOAD_BASE_DIR → the DB field(s) that reference its files.
const FOLDER_TARGETS: Record<string, Target[]> = {
  avatars: [{ model: 'user', field: 'avatarUrl', prefix: 'avatars', visibility: 'public' }],
  'campaign-covers': [
    { model: 'campaign', field: 'coverImageUrl', prefix: 'campaign-covers', visibility: 'public' },
  ],
  'brief-images': [
    { model: 'campaign', field: 'briefImageUrl', prefix: 'brief-images', visibility: 'public' },
  ],
  'rate-cards': [
    { model: 'influencerProfile', field: 'rateCardFileUrl', prefix: 'rate-cards', visibility: 'private' },
  ],
  conversations: [
    { model: 'conversation', field: 'contractUrl', prefix: 'contracts', visibility: 'private' },
    { model: 'conversation', field: 'briefFileUrl', prefix: 'briefs', visibility: 'private' },
    { model: 'conversation', field: 'paymentProofUrl', prefix: 'payment-proofs', visibility: 'private' },
    { model: 'payment', field: 'proofUrl', prefix: 'payment-proofs', visibility: 'private' },
    { model: 'draft', field: 'fileUrl', prefix: 'drafts', visibility: 'private' },
  ],
};

function contentTypeOf(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

async function objectExists(bucket: string, prefix: string, name: string): Promise<boolean> {
  const { data } = await supabase.storage.from(bucket).list(prefix, { search: name, limit: 100 });
  return (data ?? []).some((o) => o.name === name);
}

function publicUrl(objectPath: string): string {
  return supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

const stats = { migrated: 0, skipped: 0, orphans: 0 };

async function processFile(folder: string, name: string, targets: Target[]) {
  const legacyValue = `/uploads/${folder}/${name}`;

  // Which DB field, if any, still references this file by its legacy /uploads/ path?
  let match: Target | null = null;
  for (const t of targets) {
    const row = await (prisma as any)[t.model].findFirst({ where: { [t.field]: legacyValue } });
    if (row) {
      match = t;
      break;
    }
  }

  if (!match) {
    // No legacy reference. Either already migrated, or a true orphan.
    for (const t of targets) {
      const bucket = t.visibility === 'public' ? PUBLIC_BUCKET : PRIVATE_BUCKET;
      if (await objectExists(bucket, t.prefix, name)) {
        console.log(`  skip (already migrated): ${legacyValue}`);
        stats.skipped++;
        return;
      }
    }
    console.log(`  ORPHAN (no DB row references it): ${legacyValue}`);
    stats.orphans++;
    return;
  }

  const bucket = match.visibility === 'public' ? PUBLIC_BUCKET : PRIVATE_BUCKET;
  const objectPath = `${match.prefix}/${name}`;
  const newValue = match.visibility === 'public' ? publicUrl(objectPath) : objectPath;

  console.log(
    `  migrate ${legacyValue} → ${bucket}/${objectPath}  (${match.model}.${match.field})`,
  );
  if (DRY_RUN) {
    stats.migrated++;
    return;
  }

  const buffer = readFileSync(join(BASE, folder, name));
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(objectPath, buffer, { contentType: contentTypeOf(name), upsert: true });
  if (upErr) {
    console.error(`    upload FAILED: ${upErr.message}`);
    return;
  }
  // Rewrite every field that held the legacy value (updateMany covers >1 row).
  await (prisma as any)[match.model].updateMany({
    where: { [match.field]: legacyValue },
    data: { [match.field]: newValue },
  });
  stats.migrated++;
}

async function main() {
  console.log(`Backfill from ${BASE}  (${DRY_RUN ? 'DRY RUN' : 'LIVE'})\n`);
  for (const [folder, targets] of Object.entries(FOLDER_TARGETS)) {
    const dir = join(BASE, folder);
    if (!existsSync(dir)) {
      console.log(`[${folder}] (missing, skipped)`);
      continue;
    }
    const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
    console.log(`[${folder}] ${files.length} file(s)`);
    for (const name of files) await processFile(folder, name, targets);
  }
  console.log(
    `\nDone. migrated=${stats.migrated} skipped=${stats.skipped} orphans=${stats.orphans}` +
      (DRY_RUN ? '  (no changes written)' : ''),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
