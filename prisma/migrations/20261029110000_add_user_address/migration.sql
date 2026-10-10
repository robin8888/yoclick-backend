-- Dirección postal opcional de la persona.
ALTER TABLE "users" ADD COLUMN "address" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_address_length" CHECK ("address" IS NULL OR length(btrim("address")) BETWEEN 1 AND 200);
