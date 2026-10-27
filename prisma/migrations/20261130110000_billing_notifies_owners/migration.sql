-- El contexto `billing` (avisos de Stripe) avisa a los propietarios cuando su centro contrata o cambia
-- de plan: puede localizar a los propietarios y escribir el aviso, nada más.
CREATE POLICY billing_reads ON "memberships" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'billing');
CREATE POLICY billing_inserts ON "notifications" FOR INSERT
  WITH CHECK (current_setting('app.platform_role', true) = 'billing');
