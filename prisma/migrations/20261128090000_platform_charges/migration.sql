-- Registro de cobros de los planes (docs/spec/17 §4): lo que cobra Yoclick a cada centro, para el gestor.
-- Hasta que exista Stripe Billing los cobros se apuntan a mano. Importes en céntimos.

CREATE TABLE "platform_charges" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "charged_on" DATE NOT NULL,
    "concept" TEXT NOT NULL,
    "base_cents" INTEGER NOT NULL,
    "vat_basis_points" INTEGER NOT NULL,
    "vat_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "stripe_fee_cents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "payment_method" TEXT NOT NULL,
    "invoice_reference" TEXT,
    "stripe_id" TEXT,
    "customer_legal_name" TEXT,
    "customer_tax_id" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_charges_amounts_check" CHECK (
      "base_cents" >= 0 AND "vat_cents" >= 0 AND "vat_basis_points" BETWEEN 0 AND 10000
      AND "total_cents" = "base_cents" + "vat_cents"
      AND ("stripe_fee_cents" IS NULL OR "stripe_fee_cents" >= 0)
    ),
    CONSTRAINT "platform_charges_status_check" CHECK ("status" IN ('pending', 'paid', 'void')),
    CONSTRAINT "platform_charges_source_check" CHECK ("source" IN ('manual', 'stripe')),
    CONSTRAINT "platform_charges_method_check" CHECK (
      "payment_method" IN ('transfer', 'card', 'cash', 'other')
    )
);
CREATE INDEX "platform_charges_charged_on_idx" ON "platform_charges"("charged_on" DESC);
CREATE INDEX "platform_charges_center_id_charged_on_idx"
  ON "platform_charges"("center_id", "charged_on" DESC);
ALTER TABLE "platform_charges" ADD CONSTRAINT "platform_charges_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_charges" ADD CONSTRAINT "platform_charges_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El `admin` apunta y corrige cobros; el `accountant` (el gestor) solo los lee. Un cobro no se borra:
-- se anula (`void`) para que el historial cuadre con las facturas.
REVOKE DELETE ON "platform_charges" FROM yoclick_app;
ALTER TABLE "platform_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_charges" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reads ON "platform_charges" FOR SELECT
  USING (current_setting('app.platform_role', true) IN ('admin', 'accountant'));
CREATE POLICY platform_admin_inserts ON "platform_charges" FOR INSERT
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');
CREATE POLICY platform_admin_updates ON "platform_charges" FOR UPDATE
  USING (current_setting('app.platform_role', true) = 'admin')
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');

-- Para mostrar el nombre del centro en la lista de cobros, el gestor lee solo los centros.
CREATE POLICY platform_accountant_reads ON "centers" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'accountant');
