-- Bonos: el centro crea tarifas de bono, la persona lo pide (o el centro se lo asigna) y cada clase a la
-- que asiste descuenta una sesión. Sin pasarela de pago todavía: el centro activa el bono al cobrarlo.

CREATE TYPE "pass_status" AS ENUM ('pending', 'active', 'rejected');
CREATE TYPE "balance_movement_reason" AS ENUM ('consumed', 'restored');
ALTER TYPE "notification_kind" ADD VALUE 'pass_requested';
ALTER TYPE "notification_kind" ADD VALUE 'pass_activated';

CREATE TABLE "rates" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sessions_count" INTEGER NOT NULL,
    "valid_days" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    -- Servicios en los que vale; vacío = todos.
    "service_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rates_center_id_idx" ON "rates"("center_id");
ALTER TABLE "rates" ADD CONSTRAINT "rates_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rates" ADD CONSTRAINT "rates_values_valid" CHECK (
  "sessions_count" BETWEEN 1 AND 200 AND "valid_days" BETWEEN 1 AND 730 AND "price_cents" BETWEEN 0 AND 1000000
);
REVOKE DELETE ON "rates" FROM yoclick_app;
ALTER TABLE "rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rates"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

CREATE TABLE "client_passes" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "rate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "remaining_sessions" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "service_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "status" "pass_status" NOT NULL DEFAULT 'pending',
    "is_requested_by_client" BOOLEAN NOT NULL,
    "starts_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "decided_by_membership_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_passes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "client_passes_center_id_client_membership_id_status_idx"
  ON "client_passes"("center_id", "client_membership_id", "status");
CREATE INDEX "client_passes_center_id_status_idx" ON "client_passes"("center_id", "status");
ALTER TABLE "client_passes" ADD CONSTRAINT "client_passes_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_passes" ADD CONSTRAINT "client_passes_client_membership_id_fkey"
  FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_passes" ADD CONSTRAINT "client_passes_rate_id_fkey"
  FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_passes" ADD CONSTRAINT "client_passes_decided_by_membership_id_fkey"
  FOREIGN KEY ("decided_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Nunca por debajo de cero ni por encima de las que tenía.
ALTER TABLE "client_passes" ADD CONSTRAINT "client_passes_remaining_valid"
  CHECK ("remaining_sessions" >= 0 AND "remaining_sessions" <= "total_sessions");
REVOKE DELETE ON "client_passes" FROM yoclick_app;
ALTER TABLE "client_passes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_passes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_passes"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
-- El equipo ve los de todo el centro; una persona cliente, solo los suyos.
CREATE POLICY client_own ON "client_passes" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin', 'staff')
    OR "client_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );

CREATE TABLE "balance_movements" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "client_pass_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "booking_id" UUID,
    "delta" INTEGER NOT NULL,
    "reason" "balance_movement_reason" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_movements_pkey" PRIMARY KEY ("id")
);
-- Una clase descuenta una sola vez, pase lo que pase (escaneo del QR y cierre de la clase).
CREATE UNIQUE INDEX "balance_movements_booking_id_key" ON "balance_movements"("booking_id");
CREATE INDEX "balance_movements_center_id_client_pass_id_idx" ON "balance_movements"("center_id", "client_pass_id");
ALTER TABLE "balance_movements" ADD CONSTRAINT "balance_movements_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "balance_movements" ADD CONSTRAINT "balance_movements_client_pass_id_fkey"
  FOREIGN KEY ("client_pass_id") REFERENCES "client_passes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "balance_movements" ADD CONSTRAINT "balance_movements_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Libro inmutable: solo se inserta.
REVOKE UPDATE, DELETE ON "balance_movements" FROM yoclick_app;
ALTER TABLE "balance_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "balance_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "balance_movements"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
CREATE POLICY client_own ON "balance_movements" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin', 'staff')
    OR "client_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );
