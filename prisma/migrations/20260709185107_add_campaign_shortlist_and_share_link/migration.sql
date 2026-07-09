-- CreateTable
CREATE TABLE "CampaignShortlist" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "recommendationNote" TEXT,
    "proposedPrice" INTEGER,
    "createdById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignShortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignShortlistShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignShortlistShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignShortlist_campaignId_idx" ON "CampaignShortlist"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignShortlist_campaignId_influencerId_key" ON "CampaignShortlist"("campaignId", "influencerId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignShortlistShareLink_token_key" ON "CampaignShortlistShareLink"("token");

-- CreateIndex
CREATE INDEX "CampaignShortlistShareLink_campaignId_idx" ON "CampaignShortlistShareLink"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignShortlist" ADD CONSTRAINT "CampaignShortlist_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignShortlist" ADD CONSTRAINT "CampaignShortlist_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignShortlist" ADD CONSTRAINT "CampaignShortlist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignShortlistShareLink" ADD CONSTRAINT "CampaignShortlistShareLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignShortlistShareLink" ADD CONSTRAINT "CampaignShortlistShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
