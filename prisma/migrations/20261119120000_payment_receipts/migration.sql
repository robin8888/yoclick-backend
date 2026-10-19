-- Recibos de los cobros online: numeración correlativa por centro y año. Los precios llevan el IVA incluido.
ALTER TABLE "payments" ADD COLUMN "receipt_number" TEXT;
CREATE UNIQUE INDEX "payments_center_id_receipt_number_key" ON "payments"("center_id", "receipt_number");

-- Los cobros que ya estaban pagados reciben su número por orden de pago.
WITH numbered AS (
  SELECT "id",
         to_char("paid_at", 'YYYY') || '-' ||
         lpad(row_number() OVER (
           PARTITION BY "center_id", to_char("paid_at", 'YYYY') ORDER BY "paid_at", "id"
         )::text, 6, '0') AS receipt_number
  FROM "payments"
  WHERE "status" = 'succeeded' AND "paid_at" IS NOT NULL
)
UPDATE "payments" SET "receipt_number" = numbered.receipt_number
FROM numbered WHERE "payments"."id" = numbered."id";
