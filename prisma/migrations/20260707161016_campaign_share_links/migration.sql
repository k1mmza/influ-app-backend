-- CreateTable
CREATE TABLE "CampaignShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignShareLink_token_key" ON "CampaignShareLink"("token");

-- CreateIndex
CREATE INDEX "CampaignShareLink_campaignId_idx" ON "CampaignShareLink"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignShareLink" ADD CONSTRAINT "CampaignShareLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignShareLink" ADD CONSTRAINT "CampaignShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
