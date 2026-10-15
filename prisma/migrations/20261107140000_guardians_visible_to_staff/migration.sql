-- El equipo también ve los enlaces de tutores: un profesor que escribe a su grupo hace llegar el
-- mensaje de un menor a su tutor.
DROP POLICY guardian_or_administration ON "guardian_links";
CREATE POLICY guardian_or_team ON "guardian_links" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin', 'staff')
    OR "guardian_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );
