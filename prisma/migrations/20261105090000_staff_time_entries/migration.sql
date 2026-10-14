-- Fichaje del equipo: cada persona ficha con su QR (entrada y salida alternas) y puede corregir sus
-- horas; lo corregido queda marcado con las horas originales. El PDF mensual lo genera la app.

CREATE TYPE "time_entry_source" AS ENUM ('qr', 'manual');

CREATE TABLE "staff_time_entries" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    -- Fecha local del centro (su zona horaria) en la que cae la entrada.
    "work_date" DATE NOT NULL,
    "clock_in_at" TIMESTAMPTZ NOT NULL,
    "clock_out_at" TIMESTAMPTZ,
    "in_source" "time_entry_source" NOT NULL,
    "out_source" "time_entry_source",
    "scanned_by_membership_id" UUID,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "original_clock_in_at" TIMESTAMPTZ,
    "original_clock_out_at" TIMESTAMPTZ,
    "edited_at" TIMESTAMPTZ,
    "edited_by_membership_id" UUID,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_time_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_time_entries_center_id_staff_membership_id_work_date_idx"
  ON "staff_time_entries"("center_id", "staff_membership_id", "work_date");
-- Una sola entrada abierta por persona: dos escaneos a la vez no pueden abrir dos turnos.
CREATE UNIQUE INDEX "staff_time_entries_one_open_per_staff"
  ON "staff_time_entries"("staff_membership_id")
  WHERE "clock_out_at" IS NULL AND "deleted_at" IS NULL;

ALTER TABLE "staff_time_entries" ADD CONSTRAINT "staff_time_entries_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_time_entries" ADD CONSTRAINT "staff_time_entries_staff_membership_id_fkey"
  FOREIGN KEY ("staff_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_time_entries" ADD CONSTRAINT "staff_time_entries_scanned_by_membership_id_fkey"
  FOREIGN KEY ("scanned_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_time_entries" ADD CONSTRAINT "staff_time_entries_edited_by_membership_id_fkey"
  FOREIGN KEY ("edited_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_time_entries" ADD CONSTRAINT "staff_time_entries_range_valid"
  CHECK ("clock_out_at" IS NULL OR "clock_out_at" > "clock_in_at");

-- Borrado lógico: un registro de jornada no se destruye.
REVOKE DELETE ON "staff_time_entries" FROM yoclick_app;
ALTER TABLE "staff_time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_time_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_time_entries"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
-- Administración ve todo el centro; el personal, lo suyo. Además puede ver y cerrar una entrada
-- abierta o una que acaba de escanear él (para fichar a quien le enseña el QR). Clientela, nada.
CREATE POLICY team_visibility ON "staff_time_entries" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
    OR (
      NULLIF(current_setting('app.role', true), '') = 'staff'
      AND (
        "staff_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
        OR "scanned_by_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
        OR "clock_out_at" IS NULL
      )
    )
  );
