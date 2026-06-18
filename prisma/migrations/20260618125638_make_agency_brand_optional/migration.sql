-- DropForeignKey
ALTER TABLE "ClientBrand" DROP CONSTRAINT "ClientBrand_agencyId_fkey";

-- AddForeignKey
ALTER TABLE "ClientBrand" ADD CONSTRAINT "ClientBrand_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "AgencyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
