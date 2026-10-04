-- Ejecutar conectado a CADA base de datos (yoclick y yoclick_test) como postgres.
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- restricciones EXCLUDE: sin solapes de staff ni de sala
CREATE EXTENSION IF NOT EXISTS citext;      -- emails sin distinguir mayúsculas
CREATE EXTENSION IF NOT EXISTS pgcrypto;
