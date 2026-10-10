-- Quién asignó cada cita (la persona, el equipo o la administración). Nulo en las anteriores.
ALTER TABLE "bookings" ADD COLUMN "created_by_membership_id" UUID;
ALTER TABLE "bookings" ADD COLUMN "created_by_role" "membership_role";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
