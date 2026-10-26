-- Una sala puede ser un espacio exterior (un parque, un auditorio): lleva su dirección y su punto
-- exacto, y las clases que se dan en ella los heredan.

ALTER TABLE "rooms"
  ADD COLUMN "is_outdoor" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "place_address" TEXT,
  ADD COLUMN "place_latitude" DOUBLE PRECISION,
  ADD COLUMN "place_longitude" DOUBLE PRECISION;
