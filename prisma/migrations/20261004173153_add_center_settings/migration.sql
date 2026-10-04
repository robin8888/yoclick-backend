-- AlterTable
ALTER TABLE "centers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "cancel_policy" JSONB,
ADD COLUMN     "holidays" JSONB,
ADD COLUMN     "opening_hours" JSONB;
