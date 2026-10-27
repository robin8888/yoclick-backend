-- El Premium no cobra cuota de alta: el primer pago es solo la suscripción (+ IVA).
-- El importe sigue siendo editable desde la pestaña Planes de la plataforma.
UPDATE "platform_plans" SET "setup_fee_cents" = 0 WHERE "id" = 'premium';
