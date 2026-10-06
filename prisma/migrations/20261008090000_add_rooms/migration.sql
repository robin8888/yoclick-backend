-- AlterTable
ALTER TABLE "services" ADD COLUMN     "room_id" UUID;

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_center_id_idx" ON "rooms"("center_id");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Integridad: lo que la API valida, también en la base de datos.
-- ============================================================================
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_capacity_valid" CHECK ("capacity" BETWEEN 1 AND 500);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_name_not_blank" CHECK (length(btrim("name")) BETWEEN 1 AND 80);
-- Dos salas activas de un centro no pueden llamarse igual (sin distinguir mayúsculas).
CREATE UNIQUE INDEX "rooms_center_id_active_name_key"
  ON "rooms" ("center_id", lower("name")) WHERE "archived_at" IS NULL;

-- Una sala se archiva, no se borra.
REVOKE DELETE ON "rooms" FROM yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rooms"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
