-- Un vídeo apunta a su vídeo; un PDF o una imagen, a su fichero. Nunca a las dos cosas.
-- Va aparte de la migración que añade `image` al enum: Postgres no deja usar un valor nuevo en la misma transacción.
ALTER TABLE "content_items" DROP CONSTRAINT "content_items_one_source";
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_one_source" CHECK (
  ("kind" = 'video' AND "video_id" IS NOT NULL AND "document_key" IS NULL)
  OR ("kind" IN ('pdf', 'image') AND "document_key" IS NOT NULL AND "video_id" IS NULL)
);
