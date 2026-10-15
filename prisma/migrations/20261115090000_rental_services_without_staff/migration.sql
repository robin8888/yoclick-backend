-- Un servicio de alquiler cede la sala sin profesor: horarios y sesiones pueden no tener staff.
-- Las restricciones EXCLUDE de profesor ignoran las filas sin profesor (NULL no solapa).
ALTER TABLE "services" ADD COLUMN "is_rental" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "session_schedules" ALTER COLUMN "staff_membership_id" DROP NOT NULL;
ALTER TABLE "class_sessions" ALTER COLUMN "staff_membership_id" DROP NOT NULL;
