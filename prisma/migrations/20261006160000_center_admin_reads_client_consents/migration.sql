-- «Privacidad y legal»: quien administra un centro cuenta cuántos de sus clientes han dado cada
-- consentimiento. Puede leer los de las personas que son clientes de SU centro, y nada más.
-- Cambiar un consentimiento sigue siendo cosa de cada persona (la inserción no se toca).
CREATE POLICY center_admin_reads_client_consents ON "consents" FOR SELECT
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
    AND EXISTS (
      SELECT 1 FROM "memberships" AS client_membership
      WHERE client_membership."user_id" = "consents"."user_id"
        AND client_membership."center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
        AND client_membership."role" = 'client'
    )
  );
