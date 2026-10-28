-- Contestador IA de citas (add-on). Solo añade: tablas nuevas y columnas opcionales o con valor por defecto
-- que dejan el comportamiento de siempre. Docs: docs/spec/07-contestador-ia.md

-- Invitado que el contestador crea para dar una cita de prueba a quien no es alumno.
ALTER TYPE "join_source" ADD VALUE 'voice_guest';

-- Con false (por defecto) el centro funciona exactamente igual que sin el add-on.
ALTER TABLE "centers" ADD COLUMN "is_voice_receptionist_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Servicios a los que puede venir quien no es alumno (clase de prueba, visita informativa).
ALTER TABLE "services" ADD COLUMN "allows_trial_bookings" BOOLEAN NOT NULL DEFAULT false;

-- Código de 6 cifras con el que se identifica un alumno o cliente por teléfono. Único en cada centro.
ALTER TABLE "memberships" ADD COLUMN "student_code" CHAR(6);
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_student_code_format"
  CHECK ("student_code" IS NULL OR "student_code" ~ '^[0-9]{6}$');
CREATE UNIQUE INDEX "memberships_center_id_student_code_key" ON "memberships"("center_id", "student_code");

CREATE TYPE "voice_line_status" AS ENUM ('active', 'suspended');
CREATE TYPE "voice_subscription_status" AS ENUM ('active', 'paused', 'cancelled');
CREATE TYPE "voice_forwarding_mode" AS ENUM ('always', 'no_answer', 'busy', 'outside_hours');
CREATE TYPE "voice_call_outcome" AS ENUM ('booking', 'cancellation', 'reschedule', 'transfer', 'no_action', 'waitlist');

-- Número puente de cada centro (E.164). Por él se reconoce el centro de una llamada: es lo único que lo decide.
CREATE TABLE "voice_phone_lines" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "voice_line_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_phone_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voice_phone_lines_phone_number_format" CHECK ("phone_number" ~ '^\+[0-9]{8,15}$'),
    CONSTRAINT "voice_phone_lines_provider_known" CHECK ("provider" IN ('vapi', 'fake'))
);
CREATE UNIQUE INDEX "voice_phone_lines_center_id_key" ON "voice_phone_lines"("center_id");
CREATE UNIQUE INDEX "voice_phone_lines_phone_number_key" ON "voice_phone_lines"("phone_number");

CREATE TABLE "voice_agent_configs" (
    "center_id" UUID NOT NULL,
    "greeting" TEXT,
    "assistant_name" TEXT,
    "voice" TEXT,
    "language" TEXT NOT NULL DEFAULT 'es-ES',
    "forwarding_mode" "voice_forwarding_mode" NOT NULL DEFAULT 'no_answer',
    "human_transfer_phone" TEXT,
    "legal_notice" TEXT,
    "transcript_retention_days" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_agent_configs_pkey" PRIMARY KEY ("center_id"),
    CONSTRAINT "voice_agent_configs_transfer_phone_format" CHECK (
      "human_transfer_phone" IS NULL OR "human_transfer_phone" ~ '^\+[0-9]{8,15}$'
    ),
    CONSTRAINT "voice_agent_configs_retention_range" CHECK ("transcript_retention_days" BETWEEN 1 AND 365),
    CONSTRAINT "voice_agent_configs_greeting_length" CHECK ("greeting" IS NULL OR char_length("greeting") <= 500),
    CONSTRAINT "voice_agent_configs_legal_notice_length" CHECK ("legal_notice" IS NULL OR char_length("legal_notice") <= 500)
);

CREATE TABLE "voice_receptionist_subscriptions" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "status" "voice_subscription_status" NOT NULL DEFAULT 'active',
    "included_minutes" INTEGER NOT NULL,
    "period_start" TIMESTAMPTZ NOT NULL,
    "period_end" TIMESTAMPTZ NOT NULL,
    "stripe_subscription_item_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_receptionist_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voice_receptionist_subscriptions_minutes_check" CHECK ("included_minutes" >= 0),
    CONSTRAINT "voice_receptionist_subscriptions_period_check" CHECK ("period_end" > "period_start")
);
CREATE UNIQUE INDEX "voice_receptionist_subscriptions_center_id_key"
  ON "voice_receptionist_subscriptions"("center_id");

-- Precio y minutos del add-on por plan: son datos, no constantes del código.
CREATE TABLE "voice_addon_plans" (
    "plan_id" TEXT NOT NULL,
    "monthly_price_cents" INTEGER NOT NULL,
    "included_minutes" INTEGER NOT NULL,
    "overage_cents_per_minute" INTEGER NOT NULL,

    CONSTRAINT "voice_addon_plans_pkey" PRIMARY KEY ("plan_id"),
    CONSTRAINT "voice_addon_plans_values_check" CHECK (
      "monthly_price_cents" >= 0 AND "included_minutes" >= 0 AND "overage_cents_per_minute" >= 0
    )
);
INSERT INTO "voice_addon_plans" ("plan_id", "monthly_price_cents", "included_minutes", "overage_cents_per_minute")
VALUES ('basic', 4900, 150, 35), ('pro', 6900, 250, 35), ('premium', 8900, 400, 35);

CREATE TABLE "voice_call_logs" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "provider_call_id" TEXT NOT NULL,
    "caller_phone" TEXT NOT NULL,
    "caller_membership_id" UUID,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER,
    "outcome" "voice_call_outcome",
    "summary" TEXT,
    "transcript" TEXT,
    "estimated_cost_cents" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_call_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voice_call_logs_duration_check" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0)
);
CREATE UNIQUE INDEX "voice_call_logs_provider_call_id_key" ON "voice_call_logs"("provider_call_id");
CREATE INDEX "voice_call_logs_center_id_started_at_idx" ON "voice_call_logs"("center_id", "started_at");

CREATE TABLE "voice_usage_periods" (
    "center_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ NOT NULL,
    "minutes_used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "voice_usage_periods_pkey" PRIMARY KEY ("center_id", "period_start"),
    CONSTRAINT "voice_usage_periods_minutes_check" CHECK ("minutes_used" >= 0)
);

CREATE TABLE "voice_code_attempts" (
    "center_id" UUID NOT NULL,
    "caller_phone" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_code_attempts_pkey" PRIMARY KEY ("center_id", "caller_phone")
);

CREATE TABLE "voice_tool_calls" (
    "provider_call_id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "center_id" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_tool_calls_pkey" PRIMARY KEY ("provider_call_id", "tool_call_id")
);

ALTER TABLE "voice_phone_lines" ADD CONSTRAINT "voice_phone_lines_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voice_agent_configs" ADD CONSTRAINT "voice_agent_configs_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voice_receptionist_subscriptions" ADD CONSTRAINT "voice_receptionist_subscriptions_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voice_addon_plans" ADD CONSTRAINT "voice_addon_plans_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voice_call_logs" ADD CONSTRAINT "voice_call_logs_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voice_usage_periods" ADD CONSTRAINT "voice_usage_periods_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voice_code_attempts" ADD CONSTRAINT "voice_code_attempts_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voice_tool_calls" ADD CONSTRAINT "voice_tool_calls_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Row Level Security. Todo lo del contestador es del centro: solo el dueño y la administración lo ven
-- (el código de la llamada actúa con el rol `admin` del centro ya resuelto por el número puente).
-- ============================================================================
ALTER TABLE "voice_phone_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_phone_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_agent_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_agent_configs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_receptionist_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_receptionist_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_call_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_call_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_usage_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_usage_periods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_code_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_code_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_tool_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_tool_calls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_addon_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_addon_plans" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "voice_phone_lines"
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );
-- Una llamada llega sin centro: se localiza por el número al que se llamó, y solo esa fila.
CREATE POLICY lookup_by_number ON "voice_phone_lines" FOR SELECT
  USING (
    NULLIF(current_setting('app.lookup_voice_number', true), '') IS NOT NULL
    AND "phone_number" = current_setting('app.lookup_voice_number', true)
  );
CREATE POLICY platform_admin_manages ON "voice_phone_lines"
  USING (current_setting('app.platform_role', true) = 'admin')
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');

CREATE POLICY tenant_isolation ON "voice_agent_configs"
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );
CREATE POLICY platform_admin_manages ON "voice_agent_configs"
  USING (current_setting('app.platform_role', true) = 'admin')
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');

CREATE POLICY tenant_isolation ON "voice_receptionist_subscriptions"
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );
CREATE POLICY platform_admin_manages ON "voice_receptionist_subscriptions"
  USING (current_setting('app.platform_role', true) = 'admin')
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');
-- La facturación (fase 3) lee y actualiza la suscripción desde los avisos de Stripe, sin centro en contexto.
CREATE POLICY billing_manages ON "voice_receptionist_subscriptions"
  USING (current_setting('app.platform_role', true) = 'billing')
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');

CREATE POLICY tenant_isolation ON "voice_call_logs"
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );

CREATE POLICY tenant_isolation ON "voice_usage_periods"
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );
CREATE POLICY billing_reads ON "voice_usage_periods" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'billing');

CREATE POLICY tenant_isolation ON "voice_code_attempts"
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );

CREATE POLICY tenant_isolation ON "voice_tool_calls"
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );

-- Precios del add-on: los lee cualquiera (la app los enseñará) y solo la plataforma los cambia.
CREATE POLICY anyone_reads ON "voice_addon_plans" FOR SELECT USING (true);
CREATE POLICY platform_admin_updates ON "voice_addon_plans" FOR UPDATE
  USING (current_setting('app.platform_role', true) = 'admin')
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');
REVOKE INSERT, DELETE ON "voice_addon_plans" FROM yoclick_app;

-- El borrado de transcripciones vencidas no tiene sesión ni centro: ve las llamadas y la retención de cada
-- centro, y solo puede vaciar la transcripción. (Postgres comprueba también la fila nueva contra la política de
-- lectura, por eso esta no puede exigir que la transcripción siga ahí.)
CREATE POLICY retention_sweep_reads ON "voice_call_logs" FOR SELECT
  USING (current_setting('app.lookup_voice_retention_sweep', true) = 'on');
CREATE POLICY retention_sweep_updates ON "voice_call_logs" FOR UPDATE
  USING (current_setting('app.lookup_voice_retention_sweep', true) = 'on' AND "transcript" IS NOT NULL)
  WITH CHECK (current_setting('app.lookup_voice_retention_sweep', true) = 'on' AND "transcript" IS NULL);
CREATE POLICY retention_sweep_reads ON "voice_agent_configs" FOR SELECT
  USING (current_setting('app.lookup_voice_retention_sweep', true) = 'on');
