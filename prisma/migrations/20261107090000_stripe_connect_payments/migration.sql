-- Cobros online con Stripe Connect (solo plan Premium): la cuenta Express del centro, los cobros de
-- bonos y de alquileres de sala. Los centros sin Premium siguen validando a mano.

ALTER TABLE "centers" ADD COLUMN "stripe_account_id" TEXT;
ALTER TABLE "centers" ADD COLUMN "stripe_charges_enabled" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "centers_stripe_account_id_key" ON "centers"("stripe_account_id");

-- Un alquiler es un bloqueo de sala a nombre de una persona registrada, con su precio.
ALTER TABLE "room_blocks" ADD COLUMN "renter_membership_id" UUID;
ALTER TABLE "room_blocks" ADD COLUMN "price_cents" INTEGER;
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_renter_membership_id_fkey"
  FOREIGN KEY ("renter_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_price_valid"
  CHECK ("price_cents" IS NULL OR "price_cents" > 0);

CREATE TYPE "payment_kind" AS ENUM ('pass', 'room_rental');
CREATE TYPE "payment_status" AS ENUM ('pending', 'succeeded', 'failed');

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "client_pass_id" UUID,
    "room_block_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "stripe_payment_intent_id" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");
CREATE INDEX "payments_center_id_status_idx" ON "payments"("center_id", "status");
CREATE INDEX "payments_client_pass_id_idx" ON "payments"("client_pass_id");
CREATE INDEX "payments_room_block_id_idx" ON "payments"("room_block_id");

ALTER TABLE "payments" ADD CONSTRAINT "payments_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_membership_id_fkey"
  FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_pass_id_fkey"
  FOREIGN KEY ("client_pass_id") REFERENCES "client_passes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_room_block_id_fkey"
  FOREIGN KEY ("room_block_id") REFERENCES "room_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_valid" CHECK ("amount_cents" > 0);
-- Un cobro es de un bono o de un alquiler, nunca de los dos ni de ninguno (si se quita el bloqueo
-- de un alquiler, el cobro conserva su registro sin destino).
ALTER TABLE "payments" ADD CONSTRAINT "payments_one_target" CHECK (
  ("kind" = 'pass' AND "client_pass_id" IS NOT NULL AND "room_block_id" IS NULL)
  OR ("kind" = 'room_rental' AND "client_pass_id" IS NULL)
);

-- Un registro contable no se destruye.
REVOKE DELETE ON "payments" FROM yoclick_app;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payments"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
-- La administración ve los cobros de todo el centro; una persona cliente, solo los suyos.
CREATE POLICY client_own ON "payments" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
    OR "client_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );
