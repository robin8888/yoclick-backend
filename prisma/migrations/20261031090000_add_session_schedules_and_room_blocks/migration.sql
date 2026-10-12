-- Horarios de sala, grupos fijos y bloqueos (docs/spec/09 del repo de la app).
-- Un horario es una plantilla semanal («Aula 2 · lunes 18:00–19:30 · Inglés B1 · Ana · grupal») de la
-- que el servidor crea las sesiones reales con antelación; un grupo fijo son las personas matriculadas
-- en ese horario, que tienen plaza en todas sus sesiones sin reservar nada; un bloqueo es un tramo en el
-- que una sala no está disponible (alquiler, mantenimiento, evento).

-- ============================================================================
-- Servicio: en qué modo se da (privado, en grupo o de las dos formas).
-- ============================================================================
CREATE TYPE "service_mode" AS ENUM ('private', 'group', 'both');
ALTER TABLE "services" ADD COLUMN "mode" "service_mode" NOT NULL DEFAULT 'private';

-- Sala con servicio fijo: solo da ese servicio. (La relación inversa, `services.room_id`, significa
-- «este servicio solo se da en esa sala»; las dos conviven.)
ALTER TABLE "rooms" ADD COLUMN "service_id" UUID;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Horarios (plantillas semanales de sesiones).
-- ============================================================================
CREATE TYPE "schedule_status" AS ENUM ('active', 'ended');

CREATE TABLE "session_schedules" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    -- Las filas creadas juntas (martes y jueves) comparten serie: se editan y terminan a la vez.
    "series_id" UUID NOT NULL,
    "room_id" UUID,
    "service_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    "mode" "session_mode" NOT NULL DEFAULT 'group',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    -- 1 = lunes … 7 = domingo.
    "weekday" SMALLINT NOT NULL,
    -- Hora local del centro (centers.timezone), como el horario de apertura.
    "starts_at_time" CHAR(5) NOT NULL,
    "ends_at_time" CHAR(5) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" "schedule_status" NOT NULL DEFAULT 'active',
    "label" TEXT,
    -- Hasta qué fecha local (incluida) se han creado ya sus sesiones.
    "materialized_until" DATE,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "session_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "session_schedules_center_id_weekday_idx" ON "session_schedules"("center_id", "weekday");
CREATE INDEX "session_schedules_series_id_idx" ON "session_schedules"("series_id");
CREATE INDEX "session_schedules_room_id_idx" ON "session_schedules"("room_id");
CREATE INDEX "session_schedules_staff_membership_id_idx" ON "session_schedules"("staff_membership_id");

ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_staff_membership_id_fkey"
  FOREIGN KEY ("staff_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_created_by_membership_id_fkey"
  FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_weekday_valid" CHECK ("weekday" BETWEEN 1 AND 7);
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_capacity_valid" CHECK ("capacity" BETWEEN 1 AND 500);
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_times_ordered" CHECK ("starts_at_time" < "ends_at_time");
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_period_ordered" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");

-- Un horario se termina, no se borra: sus sesiones pasadas forman parte del historial.
REVOKE DELETE ON "session_schedules" FROM yoclick_app;

ALTER TABLE "session_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "session_schedules"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- ============================================================================
-- Sesiones creadas desde un horario, y «cancelar un día» con motivo.
-- ============================================================================
ALTER TABLE "class_sessions" ADD COLUMN "schedule_id" UUID;
ALTER TABLE "class_sessions" ADD COLUMN "cancelled_reason" TEXT;
ALTER TABLE "class_sessions" ADD COLUMN "cancelled_by_membership_id" UUID;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "session_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_cancelled_by_membership_id_fkey"
  FOREIGN KEY ("cancelled_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Materializar dos veces el mismo horario nunca duplica una sesión.
CREATE UNIQUE INDEX "class_sessions_schedule_id_starts_at_key"
  ON "class_sessions"("schedule_id", "starts_at") WHERE "schedule_id" IS NOT NULL;

-- ============================================================================
-- Grupos fijos: quién está matriculado en una serie y durante qué periodo.
-- ============================================================================
CREATE TABLE "schedule_enrollments" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" "schedule_status" NOT NULL DEFAULT 'active',
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "schedule_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_enrollments_center_id_series_id_idx" ON "schedule_enrollments"("center_id", "series_id");
CREATE INDEX "schedule_enrollments_client_membership_id_idx" ON "schedule_enrollments"("client_membership_id");
-- Una persona solo está matriculada una vez (activa) en la misma serie.
CREATE UNIQUE INDEX "schedule_enrollments_active_once_key"
  ON "schedule_enrollments"("series_id", "client_membership_id") WHERE "status" = 'active';

ALTER TABLE "schedule_enrollments" ADD CONSTRAINT "schedule_enrollments_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_enrollments" ADD CONSTRAINT "schedule_enrollments_client_membership_id_fkey"
  FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_enrollments" ADD CONSTRAINT "schedule_enrollments_created_by_membership_id_fkey"
  FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_enrollments" ADD CONSTRAINT "schedule_enrollments_period_ordered" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");

REVOKE DELETE ON "schedule_enrollments" FROM yoclick_app;

ALTER TABLE "schedule_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_enrollments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_enrollments"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- Una cita de matrícula no consume bono y nace y muere con la matrícula.
CREATE TYPE "booking_source" AS ENUM ('single', 'enrollment');
ALTER TABLE "bookings" ADD COLUMN "source" "booking_source" NOT NULL DEFAULT 'single';
ALTER TABLE "bookings" ADD COLUMN "enrollment_id" UUID;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_enrollment_id_fkey"
  FOREIGN KEY ("enrollment_id") REFERENCES "schedule_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "bookings_enrollment_id_idx" ON "bookings"("enrollment_id");

-- ============================================================================
-- Bloqueos de sala: alquiler, mantenimiento, evento.
-- ============================================================================
CREATE TYPE "room_block_reason" AS ENUM ('rental', 'maintenance', 'event', 'other');

CREATE TABLE "room_blocks" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "reason" "room_block_reason" NOT NULL,
    "note" TEXT,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "room_blocks_center_id_starts_at_idx" ON "room_blocks"("center_id", "starts_at");
CREATE INDEX "room_blocks_room_id_starts_at_idx" ON "room_blocks"("room_id", "starts_at");

ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_created_by_membership_id_fkey"
  FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_times_ordered" CHECK ("starts_at" < "ends_at");
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_note_length" CHECK ("note" IS NULL OR length("note") <= 200);

-- Dos bloqueos de la misma sala no se solapan. Frente a las sesiones se comprueba en código (sesiones
-- y bloqueos son tablas distintas), dentro de la misma transacción y con la sala bloqueada.
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_no_overlap"
  EXCLUDE USING gist ("room_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&);

ALTER TABLE "room_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_blocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "room_blocks"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- ============================================================================
-- Avisos nuevos: un día cancelado y una matrícula en un grupo fijo.
-- ============================================================================
ALTER TYPE "notification_kind" ADD VALUE 'session_cancelled';
ALTER TYPE "notification_kind" ADD VALUE 'schedule_enrolled';
ALTER TYPE "notification_kind" ADD VALUE 'schedule_unenrolled';
