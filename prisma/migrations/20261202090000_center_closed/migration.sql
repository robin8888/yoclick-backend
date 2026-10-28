-- Cierre de un centro cuando su propietario elimina la cuenta (Apple 5.1.1(v), RGPD art. 17).
-- No se borra nada: las facturas y los recibos tienen plazo legal de conservación (pendiente de revisión legal).
-- Lo que cambia es que nadie puede entrar, unirse ni verlo, y que el cobro y los avisos del plan paran.
ALTER TABLE "centers" ADD COLUMN "closed_at" TIMESTAMPTZ;

-- Aviso a quienes estaban en el centro de que se ha cerrado.
ALTER TYPE "notification_kind" ADD VALUE 'center_closed';

-- Un centro cerrado deja de poder encontrarse por código, por id o en el directorio (unirse, invitaciones, logo).
DROP POLICY lookup_by_join_code ON "centers";
CREATE POLICY lookup_by_join_code ON "centers" FOR SELECT
  USING ("closed_at" IS NULL AND "join_code" = NULLIF(current_setting('app.lookup_join_code', true), ''));

DROP POLICY lookup_by_id ON "centers";
CREATE POLICY lookup_by_id ON "centers" FOR SELECT
  USING ("closed_at" IS NULL AND "id" = NULLIF(current_setting('app.lookup_center_id', true), '')::uuid);

DROP POLICY directory_search ON "centers";
CREATE POLICY directory_search ON "centers" FOR SELECT
  USING ("closed_at" IS NULL AND "is_listed" AND current_setting('app.lookup_directory', true) = 'on');

-- El contexto `billing` (solo código del servidor) cierra el centro sacando a todos sus miembros: lo único que
-- puede escribir en `memberships` es el estado `left`.
CREATE POLICY billing_closes_center ON "memberships" FOR UPDATE
  USING (current_setting('app.platform_role', true) = 'billing')
  WITH CHECK (current_setting('app.platform_role', true) = 'billing' AND "status" = 'left');
