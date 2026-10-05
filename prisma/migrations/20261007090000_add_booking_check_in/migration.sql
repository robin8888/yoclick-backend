-- Asistencia por QR: cuándo llegó la persona y quién escaneó su código (lo escribe el servidor).
ALTER TABLE "bookings"
  ADD COLUMN "checked_in_at" TIMESTAMPTZ,
  ADD COLUMN "checked_in_by_membership_id" UUID;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_checked_in_by_membership_id_fkey" FOREIGN KEY ("checked_in_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
