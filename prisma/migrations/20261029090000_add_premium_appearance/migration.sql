-- AlterTable: personalización Premium del centro (fondo liso o degradado y color de la colmena).
ALTER TABLE "centers" ADD COLUMN "background_color" CHAR(7);
ALTER TABLE "centers" ADD COLUMN "background_color_end" CHAR(7);
ALTER TABLE "centers" ADD COLUMN "hive_color" CHAR(7);
ALTER TABLE "centers" ADD CONSTRAINT "centers_background_color_format"
  CHECK ("background_color" IS NULL OR "background_color" ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "centers" ADD CONSTRAINT "centers_background_color_end_format"
  CHECK ("background_color_end" IS NULL OR "background_color_end" ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "centers" ADD CONSTRAINT "centers_hive_color_format"
  CHECK ("hive_color" IS NULL OR "hive_color" ~ '^#[0-9A-Fa-f]{6}$');
-- Un degradado necesita su primer color.
ALTER TABLE "centers" ADD CONSTRAINT "centers_background_gradient_has_start"
  CHECK ("background_color_end" IS NULL OR "background_color" IS NOT NULL);
