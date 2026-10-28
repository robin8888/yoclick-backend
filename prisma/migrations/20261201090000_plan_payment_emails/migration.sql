-- Correos de pago del plan que ya se han enviado a cada centro (avisos de fin de prueba): cada tipo se
-- manda una sola vez, aunque el barrido corra muchas veces.
CREATE TABLE "plan_payment_emails_sent" (
    "center_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_payment_emails_sent_pkey" PRIMARY KEY ("center_id", "kind"),
    CONSTRAINT "plan_payment_emails_sent_kind_check"
      CHECK ("kind" IN ('trial_ending_7', 'trial_ending_3', 'trial_ending_1', 'trial_ended')),
    CONSTRAINT "plan_payment_emails_sent_center_id_fkey"
      FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Los permisos los concede ALTER DEFAULT PRIVILEGES; un envío ya apuntado no se corrige ni se borra.
REVOKE UPDATE, DELETE ON "plan_payment_emails_sent" FROM yoclick_app;
ALTER TABLE "plan_payment_emails_sent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_payment_emails_sent" FORCE ROW LEVEL SECURITY;

-- Solo el código del servidor, en el contexto `billing`, lee y apunta estos envíos: nunca viene del cliente.
CREATE POLICY billing_reads ON "plan_payment_emails_sent" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'billing');
CREATE POLICY billing_inserts ON "plan_payment_emails_sent" FOR INSERT
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');
