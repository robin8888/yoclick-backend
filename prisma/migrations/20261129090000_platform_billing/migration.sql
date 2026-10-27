-- Cobro de los planes con Stripe Billing (docs/spec/17 §2 y §6, fase P5): qué ids de Stripe tiene cada
-- plan y cada centro, hasta cuándo dura la gracia y qué avisos de Stripe ya se han procesado.

ALTER TABLE "centers"
  ADD COLUMN "stripe_customer_id" TEXT,
  ADD COLUMN "stripe_subscription_id" TEXT,
  ADD COLUMN "billing_period" TEXT,
  ADD COLUMN "grace_ends_at" TIMESTAMPTZ;
ALTER TABLE "centers" ADD CONSTRAINT "centers_billing_period_check"
  CHECK ("billing_period" IS NULL OR "billing_period" IN ('monthly', 'annual'));
CREATE UNIQUE INDEX "centers_stripe_customer_id_key" ON "centers"("stripe_customer_id");
CREATE UNIQUE INDEX "centers_stripe_subscription_id_key" ON "centers"("stripe_subscription_id");

ALTER TABLE "platform_plans"
  ADD COLUMN "stripe_product_id" TEXT,
  ADD COLUMN "stripe_monthly_price_id" TEXT,
  ADD COLUMN "stripe_annual_price_id" TEXT,
  ADD COLUMN "stripe_setup_fee_price_id" TEXT,
  ADD COLUMN "stripe_tax_rate_id" TEXT;

-- Los cobros que llegan de Stripe no los apunta ninguna persona, y los cambios automáticos tampoco
-- tienen autor: se anotan sin `actor`.
ALTER TABLE "platform_charges" ALTER COLUMN "created_by_user_id" DROP NOT NULL;
ALTER TABLE "platform_audit_log" ALTER COLUMN "actor_user_id" DROP NOT NULL;
-- Un mismo cobro de Stripe (una factura) nunca se apunta dos veces.
CREATE UNIQUE INDEX "platform_charges_stripe_id_key" ON "platform_charges"("stripe_id")
  WHERE "stripe_id" IS NOT NULL;

-- Avisos de Stripe ya procesados: Stripe reintenta, así que cada uno se atiende una sola vez.
CREATE TABLE "platform_webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_webhook_events_pkey" PRIMARY KEY ("id")
);
REVOKE UPDATE, DELETE ON "platform_webhook_events" FROM yoclick_app;
ALTER TABLE "platform_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_webhook_events" FORCE ROW LEVEL SECURITY;

-- El contexto `billing` lo fija solo el código del servidor (avisos de Stripe y barrido diario), igual
-- que `admin`: nunca viene del cliente. Solo alcanza lo que necesita el cobro de los planes.
CREATE POLICY billing_reads ON "platform_webhook_events" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'billing');
CREATE POLICY billing_inserts ON "platform_webhook_events" FOR INSERT
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');

CREATE POLICY billing_reads ON "centers" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'billing');
CREATE POLICY billing_updates ON "centers" FOR UPDATE
  USING (current_setting('app.platform_role', true) = 'billing')
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');
CREATE POLICY billing_reads ON "platform_charges" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'billing');
CREATE POLICY billing_inserts ON "platform_charges" FOR INSERT
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');
CREATE POLICY billing_inserts ON "platform_audit_log" FOR INSERT
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');
CREATE POLICY billing_updates ON "platform_plans" FOR UPDATE
  USING (current_setting('app.platform_role', true) = 'billing')
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');
