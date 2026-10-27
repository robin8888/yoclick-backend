-- Avisos al propietario de que su centro ha contratado un plan o ha cambiado de plan.
ALTER TYPE "notification_kind" ADD VALUE 'plan_subscribed';
ALTER TYPE "notification_kind" ADD VALUE 'plan_changed';
