-- Administración de la plataforma (docs/spec/17): un usuario especial de Yoclick (`admin`) y otro de solo
-- lectura para el gestor (`accountant`). Ve cifras agregadas de todos los centros, nunca datos personales.

CREATE TYPE "platform_role" AS ENUM ('none', 'admin', 'accountant');
ALTER TABLE "users" ADD COLUMN "platform_role" "platform_role" NOT NULL DEFAULT 'none';

-- El rol de plataforma NO se concede por la API: solo con el script de la línea de comandos, que usa el
-- rol de migraciones. Este trigger rechaza cualquier alta o cambio hecho con el rol de la API, aunque
-- un fallo de la aplicación lo intentara.
CREATE FUNCTION forbid_platform_role_change_by_api() RETURNS trigger AS $$
BEGIN
  IF current_user = 'yoclick_app' THEN
    IF TG_OP = 'INSERT' AND NEW."platform_role" <> 'none' THEN
      RAISE EXCEPTION 'platform_role can only be granted by the command line script';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."platform_role" IS DISTINCT FROM OLD."platform_role" THEN
      RAISE EXCEPTION 'platform_role can only be changed by the command line script';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_platform_role_guard
  BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION forbid_platform_role_change_by_api();

-- Registro de auditoría de lo que hace la plataforma: solo se inserta.
CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "center_id" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_log_created_at_idx" ON "platform_audit_log"("created_at" DESC);
CREATE INDEX "platform_audit_log_center_id_created_at_idx"
  ON "platform_audit_log"("center_id", "created_at" DESC);
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

REVOKE UPDATE, DELETE ON "platform_audit_log" FROM yoclick_app;
ALTER TABLE "platform_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_reads ON "platform_audit_log" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'admin');
CREATE POLICY platform_admin_inserts ON "platform_audit_log" FOR INSERT
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');

-- Lectura (y, en `centers`, cambio de estado y límites) para el contexto de plataforma. Las políticas
-- permisivas se combinan con OR: no cambian nada para el resto de contextos. El código de la plataforma
-- solo ejecuta agregados (contar, sumar, agrupar) y los tests comprueban que no devuelve datos personales.
CREATE POLICY platform_admin_reads ON "centers" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'admin');
CREATE POLICY platform_admin_updates ON "centers" FOR UPDATE
  USING (current_setting('app.platform_role', true) = 'admin')
  WITH CHECK (current_setting('app.platform_role', true) = 'admin');
CREATE POLICY platform_admin_reads ON "memberships" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'admin');
CREATE POLICY platform_admin_reads ON "bookings" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'admin');
-- La hora de una reserva está en su clase.
CREATE POLICY platform_admin_reads ON "class_sessions" FOR SELECT
  USING (current_setting('app.platform_role', true) = 'admin');

-- `client_own` de las reservas es restrictiva (se suma con AND): se rehace con la misma regla y la
-- salida del contexto de plataforma, que de otro modo no vería ninguna reserva.
DROP POLICY client_own ON "bookings";
CREATE POLICY client_own ON "bookings" AS RESTRICTIVE
  USING (
    current_setting('app.platform_role', true) = 'admin'
    OR NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin', 'staff')
    OR "client_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    OR "client_membership_id" IN (
      SELECT g."child_membership_id" FROM "guardian_links" g
      WHERE g."guardian_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    )
  );
