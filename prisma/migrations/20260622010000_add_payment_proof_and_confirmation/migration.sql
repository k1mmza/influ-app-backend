-- AddColumn: off-platform transfer proof uploaded by the brand/agency.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "proofUrl" TEXT;

-- AddColumn: timestamp set when the influencer confirms receipt (gates PAID status).
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
