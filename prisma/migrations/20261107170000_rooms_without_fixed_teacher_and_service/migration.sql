-- Una sala es solo un nombre y un aforo: el profesor y el servicio se eligen en cada clase. Las salas
-- que tenían un profesor o un servicio fijos los pierden; así no impiden crear clases con otros.
UPDATE "rooms" SET "staff_membership_id" = NULL, "service_id" = NULL;
