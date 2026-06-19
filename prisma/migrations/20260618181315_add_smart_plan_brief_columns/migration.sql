/*
  Warnings:

  - Added the required column `updatedAt` to the `SmartPlanBrief` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "SmartPlanBrief" DROP CONSTRAINT "SmartPlanBrief_campaignId_fkey";

-- AlterTable
ALTER TABLE "SmartPlanBrief" ADD COLUMN     "briefBody" TEXT,
ADD COLUMN     "concept" TEXT,
ADD COLUMN     "strategy" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "campaignId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SmartPlanBrief" ADD CONSTRAINT "SmartPlanBrief_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
