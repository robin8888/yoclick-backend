-- AlterEnum: aviso de una cita cambiada de hora (se envía por push).
ALTER TYPE "notification_kind" ADD VALUE 'booking_rescheduled';
ALTER TYPE "notification_kind" ADD VALUE 'booking_rescheduled_by_team';
