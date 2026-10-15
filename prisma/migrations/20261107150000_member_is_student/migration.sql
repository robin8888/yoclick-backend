-- Quien es tutor no tiene por qué ser alumno: una persona puede ser solo tutora (no cuenta para el
-- límite de clientes del plan ni en los informes de alumnos), solo alumna o las dos cosas.
ALTER TABLE "memberships" ADD COLUMN "is_student" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "invitations" ADD COLUMN "is_student" BOOLEAN NOT NULL DEFAULT true;
