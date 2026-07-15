-- Refresh-token / session store for multi-account switching + silent refresh.
-- Written idempotently (IF NOT EXISTS + guarded constraint) so it is safe to
-- re-run against a database that already has part of it applied. It only ADDS a
-- new table; the User table is left untouched.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey (guarded so re-running does not error on the existing constraint)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Session_userId_fkey'
  ) THEN
    ALTER TABLE "Session"
      ADD CONSTRAINT "Session_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
