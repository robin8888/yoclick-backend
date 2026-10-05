-- CreateEnum
CREATE TYPE "service_kind" AS ENUM ('individual');

-- CreateEnum
CREATE TYPE "class_session_status" AS ENUM ('scheduled', 'cancelled');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('confirmed', 'cancelled', 'attended', 'no_show');

-- CreateEnum
CREATE TYPE "booking_cancelled_by" AS ENUM ('client', 'staff');

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "service_kind" NOT NULL DEFAULT 'individual',
    "duration_minutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "price_cents" INTEGER,
    "color" CHAR(7),
    "booking_window_days" INTEGER NOT NULL DEFAULT 30,
    "min_notice_minutes" INTEGER NOT NULL DEFAULT 120,
    "cancel_notice_minutes" INTEGER,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_staff" (
    "service_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,

    CONSTRAINT "service_staff_pkey" PRIMARY KEY ("service_id","membership_id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "status" "class_session_status" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "class_session_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'confirmed',
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" "booking_cancelled_by",
    "cancel_within_policy" BOOLEAN,
    "idempotency_key" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_center_id_sort_order_idx" ON "services"("center_id", "sort_order");

-- CreateIndex
CREATE INDEX "service_staff_membership_id_idx" ON "service_staff"("membership_id");

-- CreateIndex
CREATE INDEX "class_sessions_center_id_starts_at_idx" ON "class_sessions"("center_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_center_id_staff_membership_id_starts_at_idx" ON "class_sessions"("center_id", "staff_membership_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_center_id_class_session_id_idx" ON "bookings"("center_id", "class_session_id");

-- CreateIndex
CREATE INDEX "bookings_center_id_client_membership_id_status_idx" ON "bookings"("center_id", "client_membership_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_client_membership_id_idempotency_key_key" ON "bookings"("client_membership_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_staff_membership_id_fkey" FOREIGN KEY ("staff_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_class_session_id_fkey" FOREIGN KEY ("class_session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_membership_id_fkey" FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Integridad (CHECK): lo que la API ya valida, también en la base de datos.
-- ============================================================================
ALTER TABLE "services" ADD CONSTRAINT "services_duration_valid"
  CHECK ("duration_minutes" BETWEEN 15 AND 480 AND "duration_minutes" % 5 = 0);
ALTER TABLE "services" ADD CONSTRAINT "services_capacity_positive" CHECK ("capacity" >= 1);
ALTER TABLE "services" ADD CONSTRAINT "services_price_not_negative"
  CHECK ("price_cents" IS NULL OR "price_cents" >= 0);
ALTER TABLE "services" ADD CONSTRAINT "services_color_format"
  CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-F]{6}$');
ALTER TABLE "services" ADD CONSTRAINT "services_booking_window_valid"
  CHECK ("booking_window_days" BETWEEN 1 AND 365);
ALTER TABLE "services" ADD CONSTRAINT "services_min_notice_valid" CHECK ("min_notice_minutes" >= 0);
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_ends_after_start"
  CHECK ("ends_at" > "starts_at");
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_capacity_positive"
  CHECK ("capacity" >= 1);

-- ============================================================================
-- Sin solapes: una persona del equipo no puede tener dos sesiones programadas a la vez.
-- Es la garantía definitiva frente a reservas simultáneas del mismo hueco: da igual cuántas
-- peticiones lleguen a la vez, la base de datos deja pasar solo una. Un rango [inicio, fin)
-- permite sesiones consecutivas (una termina a las 10:00 y la siguiente empieza a las 10:00).
-- Al cancelar, la sesión pasa a 'cancelled' y el hueco queda libre.
-- ============================================================================
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_no_staff_overlap"
  EXCLUDE USING gist (
    "staff_membership_id" WITH =,
    tstzrange("starts_at", "ends_at") WITH &&
  ) WHERE ("status" = 'scheduled');

-- ============================================================================
-- Permisos: ningún DELETE. Un servicio se archiva, una reserva se cancela y una sesión se
-- cancela: todo deja rastro. La excepción es `service_staff`, una tabla de enlace sin historial
-- propio, que sí se reescribe al cambiar quién atiende un servicio.
-- ============================================================================
REVOKE DELETE ON "services", "class_sessions", "bookings" FROM yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "services"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- `service_staff` no lleva center_id: se aísla por el servicio al que pertenece.
ALTER TABLE "service_staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_staff" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_staff"
  USING (EXISTS (
    SELECT 1 FROM "services" s
    WHERE s."id" = "service_staff"."service_id"
      AND s."center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "services" s
    WHERE s."id" = "service_staff"."service_id"
      AND s."center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
  ));

ALTER TABLE "class_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "class_sessions"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bookings"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- Restrictiva (se suma con AND a la anterior): el equipo ve todas las reservas del centro, pero
-- un cliente solo ve y crea las suyas, aunque un fallo de la aplicación olvidara filtrarlas.
CREATE POLICY client_own ON "bookings" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin', 'staff')
    OR "client_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );
