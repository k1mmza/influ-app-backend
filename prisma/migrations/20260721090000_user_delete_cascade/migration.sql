-- Enable hard-deleting a User by giving every FK that references User an
-- ON DELETE behavior. Owned/dependent data cascades; the nullable claim link on
-- an external InfluencerProfile is set null (un-claim) so the external profile
-- itself survives. Session + PasswordResetToken already cascade and are untouched.
--
-- Postgres can't alter a constraint's ON DELETE in place, so each FK is dropped
-- and re-added. Written idempotently (DROP ... IF EXISTS) so it is safe to re-run.

-- BrandProfile.userId → CASCADE
ALTER TABLE "BrandProfile" DROP CONSTRAINT IF EXISTS "BrandProfile_userId_fkey";
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgencyProfile.userId → CASCADE
ALTER TABLE "AgencyProfile" DROP CONSTRAINT IF EXISTS "AgencyProfile_userId_fkey";
ALTER TABLE "AgencyProfile" ADD CONSTRAINT "AgencyProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- InfluencerProfile.userId → CASCADE (owned profile; external profiles have null userId)
ALTER TABLE "InfluencerProfile" DROP CONSTRAINT IF EXISTS "InfluencerProfile_userId_fkey";
ALTER TABLE "InfluencerProfile" ADD CONSTRAINT "InfluencerProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- InfluencerProfile.claimedByUserId → SET NULL (un-claim; keep the external profile)
ALTER TABLE "InfluencerProfile" DROP CONSTRAINT IF EXISTS "InfluencerProfile_claimedByUserId_fkey";
ALTER TABLE "InfluencerProfile" ADD CONSTRAINT "InfluencerProfile_claimedByUserId_fkey"
  FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Wallet.userId → CASCADE
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_userId_fkey";
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Notification.userId → CASCADE
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_userId_fkey";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Review.fromUserId → CASCADE
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_fromUserId_fkey";
ALTER TABLE "Review" ADD CONSTRAINT "Review_fromUserId_fkey"
  FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Review.toUserId → CASCADE
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_toUserId_fkey";
ALTER TABLE "Review" ADD CONSTRAINT "Review_toUserId_fkey"
  FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TrackingShareLink.createdById → CASCADE
ALTER TABLE "TrackingShareLink" DROP CONSTRAINT IF EXISTS "TrackingShareLink_createdById_fkey";
ALTER TABLE "TrackingShareLink" ADD CONSTRAINT "TrackingShareLink_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CampaignShareLink.createdById → CASCADE
ALTER TABLE "CampaignShareLink" DROP CONSTRAINT IF EXISTS "CampaignShareLink_createdById_fkey";
ALTER TABLE "CampaignShareLink" ADD CONSTRAINT "CampaignShareLink_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CampaignShortlist.createdById → CASCADE
ALTER TABLE "CampaignShortlist" DROP CONSTRAINT IF EXISTS "CampaignShortlist_createdById_fkey";
ALTER TABLE "CampaignShortlist" ADD CONSTRAINT "CampaignShortlist_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CampaignShortlistShareLink.createdById → CASCADE
ALTER TABLE "CampaignShortlistShareLink" DROP CONSTRAINT IF EXISTS "CampaignShortlistShareLink_createdById_fkey";
ALTER TABLE "CampaignShortlistShareLink" ADD CONSTRAINT "CampaignShortlistShareLink_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Message.senderId → CASCADE
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
