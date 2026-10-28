-- Facturación del add-on del Contestador IA y medición de minutos (fase 3). Solo añade: columnas opcionales o con
-- valor por defecto, una tabla nueva y políticas nuevas. Docs: docs/spec/07-contestador-ia.md

-- Avisos al propietario al usar el 80 % y el 100 % de los minutos incluidos.
ALTER TYPE "notification_kind" ADD VALUE 'voice_minutes_80';
ALTER TYPE "notification_kind" ADD VALUE 'voice_minutes_100';

-- Qué hace el bot al agotar los minutos incluidos: seguir cobrando el exceso o apagarse y dejar sonar la línea.
CREATE TYPE "voice_overage_policy" AS ENUM ('continue_and_charge', 'disable_bot');
ALTER TABLE "voice_agent_configs"
  ADD COLUMN "overage_policy" "voice_overage_policy" NOT NULL DEFAULT 'continue_and_charge';

-- Los precios de Stripe de cada escalón del add-on (cuota fija mensual y minuto de exceso medido).
ALTER TABLE "voice_addon_plans"
  ADD COLUMN "stripe_monthly_price_id" TEXT,
  ADD COLUMN "stripe_overage_price_id" TEXT;

-- La línea de uso medido del add-on en la suscripción del centro (la fija ya existía).
ALTER TABLE "voice_receptionist_subscriptions" ADD COLUMN "stripe_overage_item_id" TEXT;

-- Un aviso por umbral y periodo: se apunta cuándo se envió.
ALTER TABLE "voice_usage_periods"
  ADD COLUMN "alerted_80_at" TIMESTAMPTZ,
  ADD COLUMN "alerted_100_at" TIMESTAMPTZ;

-- Cada llamada guarda cuánto de su duración fue exceso y si ya se comunicó a Stripe.
ALTER TABLE "voice_call_logs"
  ADD COLUMN "billed_minutes" INTEGER,
  ADD COLUMN "overage_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overage_reported_at" TIMESTAMPTZ;
ALTER TABLE "voice_call_logs" ADD CONSTRAINT "voice_call_logs_minutes_check"
  CHECK (("billed_minutes" IS NULL OR "billed_minutes" >= 0) AND "overage_minutes" >= 0);
CREATE INDEX "voice_call_logs_unreported_overage_idx" ON "voice_call_logs"("ended_at")
  WHERE "overage_minutes" > 0 AND "overage_reported_at" IS NULL;

-- Tope de códigos erróneos de todo el centro en una hora, sea cual sea el número que llama.
CREATE TABLE "voice_code_failure_windows" (
    "center_id" UUID NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "voice_code_failure_windows_pkey" PRIMARY KEY ("center_id", "window_start"),
    CONSTRAINT "voice_code_failure_windows_count_check" CHECK ("failed_count" >= 0)
);
ALTER TABLE "voice_code_failure_windows" ADD CONSTRAINT "voice_code_failure_windows_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "voice_code_failure_windows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_code_failure_windows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "voice_code_failure_windows"
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );

-- `billing:setup` guarda los ids de Stripe del add-on con el rol de facturación, igual que los de los planes.
CREATE POLICY billing_updates ON "voice_addon_plans" FOR UPDATE
  USING (current_setting('app.platform_role', true) = 'billing')
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');

-- Comunicar el exceso a Stripe no tiene sesión ni centro: la facturación ve las llamadas con exceso y solo
-- puede marcarlas como comunicadas. (La lectura no exige «sin comunicar»: Postgres comprueba también la fila
-- nueva contra la política de lectura.)
CREATE POLICY billing_reads_overage ON "voice_call_logs" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'billing' AND "overage_minutes" > 0);
CREATE POLICY billing_marks_overage_reported ON "voice_call_logs" FOR UPDATE
  USING (
    current_setting('app.platform_role', true) = 'billing'
    AND "overage_minutes" > 0
    AND "overage_reported_at" IS NULL
  )
  WITH CHECK (current_setting('app.platform_role', true) = 'billing' AND "overage_minutes" > 0);
