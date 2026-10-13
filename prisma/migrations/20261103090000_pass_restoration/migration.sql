-- Devolver una clase al bono (la cita se cancela) es un movimiento nuevo que apunta al descuento que
-- deshace; el libro sigue siendo solo de inserción y un descuento solo se puede devolver una vez.
ALTER TABLE "balance_movements" ADD COLUMN "restores_movement_id" UUID;
CREATE UNIQUE INDEX "balance_movements_restores_movement_id_key"
  ON "balance_movements"("restores_movement_id");
ALTER TABLE "balance_movements" ADD CONSTRAINT "balance_movements_restores_movement_id_fkey"
  FOREIGN KEY ("restores_movement_id") REFERENCES "balance_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
