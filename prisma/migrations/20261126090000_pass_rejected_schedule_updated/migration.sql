-- Dos avisos que faltaban: el centro rechaza un bono y el centro cambia un horario fijo.

ALTER TYPE "notification_kind" ADD VALUE 'pass_rejected';
ALTER TYPE "notification_kind" ADD VALUE 'schedule_updated';
