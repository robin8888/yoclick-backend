-- AlterTable: una foto de perfil por persona, la misma en todos sus centros.
ALTER TABLE "users" ADD COLUMN "photo_key" TEXT;

-- CreateTable
CREATE TABLE "staff_profile_photos" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_profile_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_profile_photos_membership_id_position_idx" ON "staff_profile_photos"("membership_id", "position");

-- AddForeignKey
ALTER TABLE "staff_profile_photos" ADD CONSTRAINT "staff_profile_photos_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_profile_photos" ADD CONSTRAINT "staff_profile_photos_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "staff_profiles"("membership_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integridad
ALTER TABLE "staff_profile_photos" ADD CONSTRAINT "staff_profile_photos_size_valid" CHECK ("size_bytes" > 0);
ALTER TABLE "staff_profile_photos" ADD CONSTRAINT "staff_profile_photos_position_valid" CHECK ("position" >= 0);

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- Los permisos sobre la tabla ya los concede ALTER DEFAULT PRIVILEGES de la migración inicial.
-- ============================================================================
ALTER TABLE "staff_profile_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_profile_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_profile_photos"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
