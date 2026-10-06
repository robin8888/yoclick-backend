-- CreateEnum
CREATE TYPE "join_source" AS ENUM ('qr', 'link', 'code', 'search');

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "join_source" "join_source";
