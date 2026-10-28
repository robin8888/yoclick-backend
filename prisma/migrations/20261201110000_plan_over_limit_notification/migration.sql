-- Aviso al propietario de que, tras cambiar de plan, el centro tiene más clientes que el tope del plan nuevo.
ALTER TYPE "notification_kind" ADD VALUE 'plan_over_limit';
