# Puesta en marcha local (sin Docker)

Requisitos: Node.js 22 o superior, npm y PostgreSQL 16 o superior instalado en el equipo.

## 1. Base de datos

1. Conéctate como `postgres` (DBeaver u otro cliente).
2. Ejecuta `scripts/database/01-create-roles-and-databases.sql` **sentencia a sentencia**, con tus propias contraseñas.
3. Conéctate a `yoclick` y después a `yoclick_test` y ejecuta `scripts/database/02-enable-extensions.sql` en cada una.
4. Comprueba el resultado con `scripts/database/03-verify-setup.sql`.

| Rol | Para qué | Puede |
|---|---|---|
| `yoclick_migrator` | Migraciones (`prisma migrate`) | Crear y alterar tablas. Dueño de las bases |
| `yoclick_app` | La API en ejecución | Solo leer y escribir filas. Sin `BYPASSRLS`, sin DDL (SEC-63) |

| Base | Uso |
|---|---|
| `yoclick` | Desarrollo |
| `yoclick_test` | Tests e2e (se vacía y se recrea; nunca contiene datos reales) |

## 2. Variables de entorno

Copia `.env.example` a `.env` y rellénalo. El fichero `.env` está en `.gitignore`: **nunca** se sube ni se comparte.
Las variables se validan al arrancar (zod): si falta alguna o es inválida, el proceso no arranca y dice cuál.

## 3. Arrancar

```bash
npm install
npm run start:dev
curl http://127.0.0.1:3000/health   # {"status":"ok"}
```

## Redis

No hace falta hasta API-3 (lista de espera y recordatorios). Hasta entonces el rate limit va en memoria y la
idempotencia en PostgreSQL, detrás de interfaces para poder cambiarlo sin tocar los casos de uso.
