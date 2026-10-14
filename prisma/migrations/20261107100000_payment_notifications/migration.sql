-- Avisos de cobros: la persona sabe que le han puesto un alquiler (y su precio) y la administración
-- sabe cuándo le han pagado un bono o un alquiler.
ALTER TYPE "notification_kind" ADD VALUE 'room_rental_assigned';
ALTER TYPE "notification_kind" ADD VALUE 'payment_received';
