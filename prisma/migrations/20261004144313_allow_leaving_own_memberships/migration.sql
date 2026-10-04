-- Una persona puede dejar un centro (y, al eliminar su cuenta, todos a la vez): pasar sus PROPIAS
-- membresías a "left". Nada más: no puede cambiar su rol, ni reactivarse, ni tocar las de otra persona.
--
-- Solo sin centro en contexto, igual que la lectura de "Mis centros": dentro de un centro manda el
-- aislamiento por centro, y quien administra el centro cambia membresías por sus propios permisos.
CREATE POLICY own_membership_leave ON "memberships" FOR UPDATE
  USING (
    NULLIF(current_setting('app.center_id', true), '') IS NULL
    AND "user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.center_id', true), '') IS NULL
    AND "user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND "status" = 'left'
  );
