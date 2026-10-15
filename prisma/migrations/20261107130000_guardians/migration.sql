-- Tutores: una persona adulta del centro responsable de uno o varios menores. Los menores no tienen
-- cuenta propia con la que hablar o reservar: lo hace su tutor, y es el centro quien enlaza a cada
-- tutor con su hijo para comprobar que lo es.

CREATE TABLE "guardian_links" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "guardian_membership_id" UUID NOT NULL,
    "child_membership_id" UUID NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guardian_links_guardian_child_key"
  ON "guardian_links"("guardian_membership_id", "child_membership_id");
CREATE INDEX "guardian_links_center_id_child_membership_id_idx"
  ON "guardian_links"("center_id", "child_membership_id");

ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_guardian_membership_id_fkey"
  FOREIGN KEY ("guardian_membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_child_membership_id_fkey"
  FOREIGN KEY ("child_membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_created_by_membership_id_fkey"
  FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_distinct_people"
  CHECK ("guardian_membership_id" <> "child_membership_id");

ALTER TABLE "guardian_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardian_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "guardian_links"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
-- La administración ve todos los enlaces; un tutor, los suyos; el equipo no los necesita.
CREATE POLICY guardian_or_administration ON "guardian_links" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
    OR "guardian_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );

-- Un tutor ve las reservas y los bonos de sus hijos, igual que cada uno ve los suyos.
DROP POLICY client_own ON "bookings";
CREATE POLICY client_own ON "bookings" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin', 'staff')
    OR "client_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    OR "client_membership_id" IN (
      SELECT g."child_membership_id" FROM "guardian_links" g
      WHERE g."guardian_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    )
  );

DROP POLICY client_own ON "client_passes";
CREATE POLICY client_own ON "client_passes" AS RESTRICTIVE
  USING (
    NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin', 'staff')
    OR "client_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    OR "client_membership_id" IN (
      SELECT g."child_membership_id" FROM "guardian_links" g
      WHERE g."guardian_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    )
  );
