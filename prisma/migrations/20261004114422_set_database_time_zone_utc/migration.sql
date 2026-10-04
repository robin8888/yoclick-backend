-- Toda sesión nueva de esta base de datos trabaja en UTC.
--
-- El adaptador de Prisma envía las fechas como hora UTC sin indicar la zona, y PostgreSQL las
-- interpreta en la zona de la sesión. Con la zona del servidor (p. ej. Europe/Madrid) todo lo guardado
-- quedaba desplazado horas respecto a now(), y una caducidad calculada en la aplicación no coincidía
-- con la que veía la base de datos. La API además lo fija en cada conexión; esto protege a cualquier
-- otro cliente (migraciones, scripts, consultas a mano).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;
