-- CreateEnum
CREATE TYPE "staff_profile_status" AS ENUM ('draft', 'pending', 'published', 'changes_requested');

-- CreateEnum
CREATE TYPE "staff_review_status" AS ENUM ('pending', 'published', 'rejected');

-- AlterEnum: avisos del perfil del equipo y de sus opiniones (se envían por push).
ALTER TYPE "notification_kind" ADD VALUE 'staff_profile_submitted';
ALTER TYPE "notification_kind" ADD VALUE 'staff_profile_reviewed';
ALTER TYPE "notification_kind" ADD VALUE 'staff_review_received';

-- AlterTable
ALTER TABLE "centers" ADD COLUMN "reviews_need_approval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "centers" ADD COLUMN "show_team_on_web" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "videos" ADD COLUMN "technique_of_membership_id" UUID;

-- CreateTable
CREATE TABLE "staff_profiles" (
    "membership_id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "specialties" TEXT[],
    "languages" TEXT[],
    "status" "staff_profile_status" NOT NULL DEFAULT 'draft',
    "review_note" TEXT,
    "publish_consent_at" TIMESTAMPTZ,
    "submitted_at" TIMESTAMPTZ,
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by_membership_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("membership_id")
);

-- CreateTable
CREATE TABLE "staff_certifications" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "verified_at" TIMESTAMPTZ,
    "verified_by_membership_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_reviews" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "staff_review_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moderated_at" TIMESTAMPTZ,
    "moderated_by_membership_id" UUID,

    CONSTRAINT "staff_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_profiles_center_id_status_idx" ON "staff_profiles"("center_id", "status");

-- CreateIndex
CREATE INDEX "staff_certifications_membership_id_idx" ON "staff_certifications"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_reviews_booking_id_key" ON "staff_reviews"("booking_id");

-- CreateIndex
CREATE INDEX "staff_reviews_center_id_status_idx" ON "staff_reviews"("center_id", "status");

-- CreateIndex
CREATE INDEX "staff_reviews_staff_membership_id_status_idx" ON "staff_reviews"("staff_membership_id", "status");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_technique_of_membership_id_fkey" FOREIGN KEY ("technique_of_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_reviewed_by_membership_id_fkey" FOREIGN KEY ("reviewed_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "staff_profiles"("membership_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_verified_by_membership_id_fkey" FOREIGN KEY ("verified_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_reviews" ADD CONSTRAINT "staff_reviews_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_reviews" ADD CONSTRAINT "staff_reviews_staff_membership_id_fkey" FOREIGN KEY ("staff_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_reviews" ADD CONSTRAINT "staff_reviews_client_membership_id_fkey" FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_reviews" ADD CONSTRAINT "staff_reviews_moderated_by_membership_id_fkey" FOREIGN KEY ("moderated_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Integridad
-- ============================================================================
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_headline_length" CHECK ("headline" IS NULL OR length("headline") <= 120);
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_bio_length" CHECK ("bio" IS NULL OR length("bio") <= 1000);
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_specialties_count" CHECK (cardinality("specialties") <= 8);
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_languages_count" CHECK (cardinality("languages") <= 8);
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_name_not_blank" CHECK (length(btrim("name")) BETWEEN 1 AND 120);
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_detail_length" CHECK ("detail" IS NULL OR length("detail") <= 120);
ALTER TABLE "staff_reviews" ADD CONSTRAINT "staff_reviews_rating_valid" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "staff_reviews" ADD CONSTRAINT "staff_reviews_comment_length" CHECK ("comment" IS NULL OR length("comment") <= 500);

-- Las opiniones son constancia: se moderan, no se borran.
REVOKE DELETE ON "staff_reviews" FROM yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "staff_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_profiles"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

ALTER TABLE "staff_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_certifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_certifications"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

ALTER TABLE "staff_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_reviews"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
