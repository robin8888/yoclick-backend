-- La biblioteca no archiva: borrar una pieza libera su espacio.
ALTER TABLE "content_items" DROP COLUMN "archived_at";
