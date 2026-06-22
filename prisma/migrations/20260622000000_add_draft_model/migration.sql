-- CreateTable: conversation-scoped content drafts (influencer-authored, brand-reviewed).
CREATE TABLE IF NOT EXISTS "Draft" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "fileUrl" TEXT,
    "linkUrl" TEXT,
    "contentType" TEXT,
    "revisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Draft_conversationId_idx" ON "Draft"("conversationId");

-- AddForeignKey (guarded — Postgres has no ADD CONSTRAINT IF NOT EXISTS)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Draft_conversationId_fkey'
    ) THEN
        ALTER TABLE "Draft"
            ADD CONSTRAINT "Draft_conversationId_fkey"
            FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
