-- AlterTable: espacio de fotos de la galería por centro (100 MiB por defecto).
ALTER TABLE "centers" ADD COLUMN "photo_storage_limit_bytes" BIGINT NOT NULL DEFAULT 104857600;
ALTER TABLE "centers" ADD CONSTRAINT "centers_photo_storage_limit_valid" CHECK ("photo_storage_limit_bytes" >= 0);
