-- Permisos y aislamiento de las notificaciones (la tabla se crea en 20261006134128_add_notifications).

-- Un aviso no se borra: se marca como leído.
REVOKE DELETE ON "notifications" FROM yoclick_app;

-- Row Level Security (SEC-41), como el resto de tablas del centro.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
