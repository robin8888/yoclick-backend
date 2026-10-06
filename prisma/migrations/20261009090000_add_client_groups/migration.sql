-- CreateEnum
CREATE TYPE "client_level" AS ENUM ('beginner', 'intermediate', 'advanced');

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "group_id" UUID,
ADD COLUMN     "level" "client_level";

-- CreateTable
CREATE TABLE "client_groups" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" "client_level",
    "instructor_membership_id" UUID,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_groups_center_id_idx" ON "client_groups"("center_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "client_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_instructor_membership_id_fkey" FOREIGN KEY ("instructor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Integridad y permisos
-- ============================================================================
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_name_not_blank"
  CHECK (length(btrim("name")) BETWEEN 1 AND 80);
-- Dos grupos activos de un centro no pueden llamarse igual (sin distinguir mayúsculas).
CREATE UNIQUE INDEX "client_groups_center_id_active_name_key"
  ON "client_groups" ("center_id", lower("name")) WHERE "archived_at" IS NULL;
-- Un grupo se archiva, no se borra.
REVOKE DELETE ON "client_groups" FROM yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "client_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_groups"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
