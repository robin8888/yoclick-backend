-- Ejecutar como superusuario (postgres), cada sentencia por separado en DBeaver
-- (Ctrl+Enter con el cursor en la sentencia; CREATE DATABASE no admite bloques).
-- Sustituye las contraseñas por valores propios de ~24 caracteres alfanuméricos
-- y NO las subas al repositorio: van solo en el .env.

-- Dueño de las tablas. Solo para migraciones (SEC-63). CREATEDB: Prisma crea su base "shadow".
CREATE ROLE yoclick_migrator LOGIN PASSWORD 'CHANGE_ME_MIGRATOR'
  NOSUPERUSER NOBYPASSRLS CREATEDB NOCREATEROLE;

-- Rol de la API en ejecución: sin BYPASSRLS, sin DDL, sin ser dueño de nada.
CREATE ROLE yoclick_app LOGIN PASSWORD 'CHANGE_ME_APP'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE DATABASE yoclick      OWNER yoclick_migrator ENCODING 'UTF8';
CREATE DATABASE yoclick_test OWNER yoclick_migrator ENCODING 'UTF8';

REVOKE ALL ON DATABASE yoclick      FROM PUBLIC;
REVOKE ALL ON DATABASE yoclick_test FROM PUBLIC;
GRANT CONNECT ON DATABASE yoclick      TO yoclick_app;
GRANT CONNECT ON DATABASE yoclick_test TO yoclick_app;
