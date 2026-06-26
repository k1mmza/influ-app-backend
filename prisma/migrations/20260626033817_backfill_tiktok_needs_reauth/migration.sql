-- Data-only backfill (no schema change). Every TikTok PlatformAccount connected
-- before the `video.list` scope was added is now stale: its token can't read
-- /v2/video/query/, so the daily sync would throw TikTokAuthError and set
-- needsReauth lazily on first run. We front-run that here so the frontend
-- reconnect banner is accurate BEFORE the first post-deploy sync.
--
-- Idempotent: re-running only re-sets already-true rows to true (no-op via the
-- `needsReauth = false` guard). Only ever sets TRUE — never clears the flag, so
-- it can't un-flag an account already flagged at runtime.
--
-- Scoped strictly to platform = 'tiktok' (the lowercase value written by
-- TikTokStrategy.platform). YouTube and every other platform are untouched.
--
-- DOWN MIGRATION: intentionally a no-op. We cannot reverse this safely because
-- we don't know which TikTok accounts were already needsReauth = true before the
-- backfill ran — blindly setting them back to false would wrongly clear genuine
-- runtime flags. Prisma's migrate workflow doesn't execute down migrations
-- anyway; this note records that the backfill is deliberately not auto-reversible.
UPDATE "PlatformAccount"
SET "needsReauth" = true
WHERE "platform" = 'tiktok'
  AND "needsReauth" = false;
