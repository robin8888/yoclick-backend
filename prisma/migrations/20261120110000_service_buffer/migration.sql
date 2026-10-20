-- Margen entre citas: minutos que quedan libres tras cada cita de un servicio (preparar, limpiar).
-- Los servicios que ya existen quedan sin margen.

ALTER TABLE "services" ADD COLUMN "buffer_minutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "services" ADD CONSTRAINT "services_buffer_minutes_range"
  CHECK ("buffer_minutes" >= 0 AND "buffer_minutes" <= 240);
