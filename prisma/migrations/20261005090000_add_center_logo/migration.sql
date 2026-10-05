-- AlterTable
ALTER TABLE "centers" ADD COLUMN     "logo_updated_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "center_logos" (
    "center_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "center_logos_pkey" PRIMARY KEY ("center_id")
);

-- AddForeignKey
ALTER TABLE "center_logos" ADD CONSTRAINT "center_logos_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "center_logos" ADD CONSTRAINT "center_logos_content_type_allowed"
  CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp'));
ALTER TABLE "center_logos" ADD CONSTRAINT "center_logos_max_size"
  CHECK (octet_length("data") BETWEEN 1 AND 716800);

-- ============================================================================
-- Un logo se sustituye (UPDATE) pero la API nunca lo borra: sin DELETE (los privilegios por
-- defecto lo concederían).
-- ============================================================================
REVOKE DELETE ON "center_logos" FROM yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41).
-- ============================================================================
ALTER TABLE "center_logos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "center_logos" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "center_logos"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- Lectura pública y estrecha: el logo es público, pero solo se obtiene presentando el id del
-- centro (mismo ajuste que `lookup_by_id` de `centers`); no hay forma de listar logos.
CREATE POLICY lookup_by_id ON "center_logos" FOR SELECT
  USING ("center_id" = NULLIF(current_setting('app.lookup_center_id', true), '')::uuid);
