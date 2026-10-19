-- Lista de espera: una clase llena admite personas en espera. Al liberarse una plaza se le ofrece a la
-- primera, que tiene 12 horas para confirmarla; si no, pasa a la siguiente.

CREATE TYPE "waitlist_status" AS ENUM ('waiting', 'offered', 'confirmed', 'expired', 'cancelled');
ALTER TYPE "notification_kind" ADD VALUE 'waitlist_offer';
ALTER TYPE "notification_kind" ADD VALUE 'waitlist_offer_expired';

CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "class_session_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "status" "waitlist_status" NOT NULL DEFAULT 'waiting',
    "offered_at" TIMESTAMPTZ,
    "offer_expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "waitlist_entries_center_id_class_session_id_status_idx"
  ON "waitlist_entries"("center_id", "class_session_id", "status");
CREATE INDEX "waitlist_entries_center_id_client_membership_id_status_idx"
  ON "waitlist_entries"("center_id", "client_membership_id", "status");
-- Una persona solo puede estar una vez en la espera de una clase (esperando u ofrecida).
CREATE UNIQUE INDEX "waitlist_entries_active_per_person_key"
  ON "waitlist_entries"("class_session_id", "client_membership_id")
  WHERE "status" IN ('waiting', 'offered');
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_class_session_id_fkey"
  FOREIGN KEY ("class_session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_client_membership_id_fkey"
  FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Una oferta siempre lleva su caducidad.
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_offer_has_expiry"
  CHECK ("status" <> 'offered' OR "offer_expires_at" IS NOT NULL);

REVOKE DELETE ON "waitlist_entries" FROM yoclick_app;
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waitlist_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "waitlist_entries"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
-- El barrido que pasa la plaza a la siguiente persona solo necesita saber de qué centros hay ofertas
-- caducadas: lee esas filas y nada más.
CREATE POLICY waitlist_sweep ON "waitlist_entries" FOR SELECT
  USING (
    current_setting('app.lookup_waitlist_sweep', true) = 'on'
    AND "status" = 'offered' AND "offer_expires_at" <= now()
  );
-- El equipo ve la espera de todo el centro; una persona cliente, solo la suya.
CREATE POLICY client_own ON "waitlist_entries" AS RESTRICTIVE
  USING (
    current_setting('app.lookup_waitlist_sweep', true) = 'on'
    OR NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin', 'staff')
    OR "client_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );
