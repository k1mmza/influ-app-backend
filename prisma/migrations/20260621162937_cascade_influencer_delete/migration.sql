-- DropForeignKey
ALTER TABLE "CampaignApplication" DROP CONSTRAINT "CampaignApplication_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "PastCollaboration" DROP CONSTRAINT "PastCollaboration_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "SubmittedContent" DROP CONSTRAINT "SubmittedContent_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "TrackingResult" DROP CONSTRAINT "TrackingResult_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "TrackingResult" DROP CONSTRAINT "TrackingResult_submittedContentId_fkey";

-- AddForeignKey
ALTER TABLE "SubmittedContent" ADD CONSTRAINT "SubmittedContent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CampaignApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastCollaboration" ADD CONSTRAINT "PastCollaboration_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignApplication" ADD CONSTRAINT "CampaignApplication_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingResult" ADD CONSTRAINT "TrackingResult_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingResult" ADD CONSTRAINT "TrackingResult_submittedContentId_fkey" FOREIGN KEY ("submittedContentId") REFERENCES "SubmittedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
