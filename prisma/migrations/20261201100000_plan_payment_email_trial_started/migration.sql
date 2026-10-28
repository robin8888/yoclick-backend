-- Se añade el correo de bienvenida de la prueba, con los enlaces de pago, a los tipos que se apuntan una vez por centro.
ALTER TABLE "plan_payment_emails_sent" DROP CONSTRAINT "plan_payment_emails_sent_kind_check";
ALTER TABLE "plan_payment_emails_sent" ADD CONSTRAINT "plan_payment_emails_sent_kind_check"
  CHECK ("kind" IN ('trial_started', 'trial_ending_7', 'trial_ending_3', 'trial_ending_1', 'trial_ended'));
