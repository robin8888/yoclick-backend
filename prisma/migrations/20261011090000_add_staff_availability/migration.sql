-- CreateEnum
CREATE TYPE "absence_reason" AS ENUM ('vacation', 'training', 'personal', 'other');

-- CreateTable
CREATE TABLE "staff_availability" (
    "membership_id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "weekly_hours" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("membership_id")
);

-- CreateTable
CREATE TABLE "staff_absences" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "reason" "absence_reason" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_absences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_availability_center_id_idx" ON "staff_availability"("center_id");

-- CreateIndex
CREATE INDEX "staff_absences_center_id_membership_id_idx" ON "staff_absences"("center_id", "membership_id");

-- AddForeignKey
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Integridad: lo que la API valida, también en la base de datos.
-- ============================================================================
ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_dates_ordered" CHECK ("starts_on" <= "ends_on");

-- Una ausencia se quita de verdad (no es un registro contable); el horario se reemplaza.
-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "staff_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_availability" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_availability"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

ALTER TABLE "staff_absences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_absences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_absences"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
