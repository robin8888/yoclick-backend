-- AddForeignKey: la opinión cuelga de la reserva (la sesión real) de la que habla.
ALTER TABLE "staff_reviews" ADD CONSTRAINT "staff_reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
