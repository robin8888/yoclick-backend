-- Salas con profesor y citas grupales: cada sala la da una persona del equipo y cada sesión dice
-- en qué sala se da y si es privada (una persona) o grupal (tantas como el aforo de la sala).

CREATE TYPE "session_mode" AS ENUM ('private', 'group');

ALTER TABLE "rooms" ADD COLUMN "staff_membership_id" UUID;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_staff_membership_id_fkey"
  FOREIGN KEY ("staff_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "rooms_staff_membership_id_idx" ON "rooms"("staff_membership_id");

ALTER TABLE "class_sessions" ADD COLUMN "room_id" UUID;
ALTER TABLE "class_sessions" ADD COLUMN "mode" "session_mode" NOT NULL DEFAULT 'private';
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "class_sessions_room_id_starts_at_idx" ON "class_sessions"("room_id", "starts_at");

-- Una sala no puede tener dos sesiones programadas a la vez: en una sala grupal caben muchas
-- personas, pero en una única sesión. Mismo mecanismo que el de la persona del equipo.
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_no_room_overlap"
  EXCLUDE USING gist (
    "room_id" WITH =,
    tstzrange("starts_at", "ends_at") WITH &&
  ) WHERE ("status" = 'scheduled' AND "room_id" IS NOT NULL);
