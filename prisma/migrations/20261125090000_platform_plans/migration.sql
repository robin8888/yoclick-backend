-- Planes de Yoclick (docs/spec/17 §2.1): precio, cuota de alta y límites en una tabla, no en el código.
-- Cada centro tiene un plan; durante la prueba de 14 días es Pro.

CREATE TABLE "platform_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_price_cents" INTEGER NOT NULL,
    "annual_monthly_price_cents" INTEGER NOT NULL,
    "setup_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "max_clients" INTEGER,
    "document_storage_limit_bytes" BIGINT NOT NULL,
    "video_storage_limit_bytes" BIGINT,
    "sort_order" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_plans_prices_check" CHECK (
      "monthly_price_cents" >= 0 AND "annual_monthly_price_cents" >= 0 AND "setup_fee_cents" >= 0
      AND "annual_monthly_price_cents" <= "monthly_price_cents"
    )
);

INSERT INTO "platform_plans"
  ("id", "name", "monthly_price_cents", "annual_monthly_price_cents", "setup_fee_cents",
   "max_clients", "document_storage_limit_bytes", "video_storage_limit_bytes", "sort_order")
VALUES
  ('basic',   'Básico',   3900,  3200,     0,  150,  1073741824, NULL,        1),
  ('pro',     'Pro',      7900,  6500,     0,  500,  5368709120, NULL,        2),
  ('premium', 'Premium', 14900, 12400, 29000, NULL, 21474836480, 21474836480, 3);

ALTER TABLE "centers" ADD COLUMN "plan_id" TEXT NOT NULL DEFAULT 'pro';
ALTER TABLE "centers" ADD CONSTRAINT "centers_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "centers_plan_id_idx" ON "centers"("plan_id");

-- Los precios los puede leer cualquiera con sesión (el centro verá el de su plan); solo los cambia la
-- administración de la plataforma. Nadie puede borrar ni crear planes con el rol de la API.
REVOKE INSERT, DELETE ON "platform_plans" FROM yoclick_app;
ALTER TABLE "platform_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_readable ON "platform_plans" FOR SELECT USING (true);
CREATE POLICY platform_admin_updates ON "platform_plans" FOR UPDATE
  USING (current_setting('app.platform_role', true) = 'admin')
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');
