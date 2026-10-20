-- Módulos de un centro: lo que no usa se apaga (contenido, asistencia con QR, bonos, lista de espera
-- y salas). Guarda lo apagado, no lo encendido: los centros que ya existen quedan con todo encendido.

ALTER TABLE "centers" ADD COLUMN "disabled_modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
