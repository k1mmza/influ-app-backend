-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- AlterTable
ALTER TABLE "InfluencerProfile" ADD COLUMN     "gender" "Gender";
