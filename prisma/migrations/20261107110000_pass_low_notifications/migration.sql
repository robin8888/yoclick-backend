-- Avisos al cliente de que su bono está a punto de agotarse o ya se ha agotado.
ALTER TYPE "notification_kind" ADD VALUE 'pass_running_low';
ALTER TYPE "notification_kind" ADD VALUE 'pass_exhausted';
