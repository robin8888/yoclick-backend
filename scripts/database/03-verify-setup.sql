-- Debe devolver los dos roles con rolbypassrls = false y rolsuper = false.
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname LIKE 'yoclick%' ORDER BY rolname;

-- Debe devolver yoclick y yoclick_test con dueño yoclick_migrator.
SELECT d.datname, r.rolname AS owner
FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
WHERE d.datname LIKE 'yoclick%' ORDER BY d.datname;

-- Ejecutado dentro de cada base: deben aparecer las tres extensiones.
SELECT extname FROM pg_extension WHERE extname IN ('btree_gist', 'citext', 'pgcrypto') ORDER BY extname;
