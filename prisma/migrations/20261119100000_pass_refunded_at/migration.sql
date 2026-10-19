-- El personal no ve los cobros (RLS): el bono guarda por si mismo que se reembolso entero.
ALTER TABLE "client_passes" ADD COLUMN "refunded_at" TIMESTAMPTZ;
