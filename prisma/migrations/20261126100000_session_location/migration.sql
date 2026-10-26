-- Ubicación de una clase fuera de las salas del centro (exterior, auditorio…). Va en el horario y se
-- copia a cada sesión, de modo que un día se puede cambiar sin tocar el resto de la serie.

ALTER TABLE "session_schedules"
  ADD COLUMN "location_name" TEXT,
  ADD COLUMN "location_address" TEXT,
  ADD COLUMN "location_latitude" DOUBLE PRECISION,
  ADD COLUMN "location_longitude" DOUBLE PRECISION;

ALTER TABLE "class_sessions"
  ADD COLUMN "location_name" TEXT,
  ADD COLUMN "location_address" TEXT,
  ADD COLUMN "location_latitude" DOUBLE PRECISION,
  ADD COLUMN "location_longitude" DOUBLE PRECISION;
