-- CreateEnum
CREATE TYPE "video_status" AS ENUM ('uploading', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "video_review_status" AS ENUM ('approved', 'pending', 'changes_requested');

-- AlterEnum: avisos del vídeo de presentación del equipo (se envían por push).
ALTER TYPE "notification_kind" ADD VALUE 'staff_video_submitted';
ALTER TYPE "notification_kind" ADD VALUE 'staff_video_reviewed';

-- AlterTable
ALTER TABLE "centers" ADD COLUMN "video_storage_limit_bytes" BIGINT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN "profile_video_id" UUID;

-- AlterTable
ALTER TABLE "routine_items" ADD COLUMN "video_id" UUID;

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "provider_video_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "video_status" NOT NULL DEFAULT 'uploading',
    "review_status" "video_review_status" NOT NULL DEFAULT 'approved',
    "review_note" TEXT,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER,
    "uploaded_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "videos_provider_video_id_key" ON "videos"("provider_video_id");

-- CreateIndex
CREATE INDEX "videos_center_id_idx" ON "videos"("center_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_profile_video_id_key" ON "memberships"("profile_video_id");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_uploaded_by_membership_id_fkey" FOREIGN KEY ("uploaded_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_profile_video_id_fkey" FOREIGN KEY ("profile_video_id") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Integridad
-- ============================================================================
ALTER TABLE "videos" ADD CONSTRAINT "videos_title_not_blank" CHECK (length(btrim("title")) BETWEEN 1 AND 120);
ALTER TABLE "videos" ADD CONSTRAINT "videos_size_valid" CHECK ("size_bytes" >= 0);
ALTER TABLE "centers" ADD CONSTRAINT "centers_video_storage_limit_valid" CHECK ("video_storage_limit_bytes" IS NULL OR "video_storage_limit_bytes" >= 0);

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "videos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "videos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "videos"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
