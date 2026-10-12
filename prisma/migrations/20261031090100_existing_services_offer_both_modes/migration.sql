-- Los servicios que ya existían se daban en privado y en grupo según decidiera el centro al asignar
-- la cita: conservan ese comportamiento («ambas»). Los nuevos nacen en privado hasta que el centro
-- diga lo contrario.
UPDATE "services" SET "mode" = 'both';
