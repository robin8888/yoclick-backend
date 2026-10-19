-- Lo que el centro ya ha devuelto de cada cobro, para mostrarlo y anular el bono si es total.
ALTER TABLE "payments" ADD COLUMN "refunded_cents" INTEGER NOT NULL DEFAULT 0;
