-- Borrado lógico de avisos: quien los recibe puede quitarlos de su lista, pero la fila se conserva.
ALTER TABLE "notifications" ADD COLUMN "deleted_at" TIMESTAMPTZ;

-- La lista de cada persona solo mira los no borrados, del más reciente al más antiguo.
CREATE INDEX "notifications_visible_idx"
  ON "notifications" ("center_id", "recipient_membership_id", "created_at")
  WHERE "deleted_at" IS NULL;
