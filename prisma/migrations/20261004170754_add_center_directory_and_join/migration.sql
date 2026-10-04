-- AlterTable
ALTER TABLE "centers" ADD COLUMN     "city" TEXT,
ADD COLUMN     "is_listed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "max_clients" INTEGER;

ALTER TABLE "centers" ADD CONSTRAINT "centers_latitude_range" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90);
ALTER TABLE "centers" ADD CONSTRAINT "centers_longitude_range" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);
ALTER TABLE "centers" ADD CONSTRAINT "centers_max_clients_positive" CHECK ("max_clients" IS NULL OR "max_clients" > 0);

-- ============================================================================
-- Lectura pública y estrecha de centros (unirse). Una persona sin sesión, o sin pertenecer aún al
-- centro, solo puede ver UN centro si presenta su código o su id, o los centros listados en la búsqueda.
-- Cada política exige un ajuste que solo fija el código de la aplicación; sin él no coincide con nada.
-- ============================================================================
CREATE POLICY lookup_by_join_code ON "centers" FOR SELECT
  USING ("join_code" = NULLIF(current_setting('app.lookup_join_code', true), ''));

CREATE POLICY lookup_by_id ON "centers" FOR SELECT
  USING ("id" = NULLIF(current_setting('app.lookup_center_id', true), '')::uuid);

CREATE POLICY directory_search ON "centers" FOR SELECT
  USING ("is_listed" AND current_setting('app.lookup_directory', true) = 'on');
