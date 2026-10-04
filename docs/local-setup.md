# Puesta en marcha local (sin Docker)

Requisitos: Node.js 22 o superior, npm y PostgreSQL 16 o superior instalado en el equipo.

## 1. Base de datos

1. Conéctate como `postgres` (DBeaver u otro cliente).
2. Ejecuta `scripts/database/01-create-roles-and-databases.sql` **sentencia a sentencia**, con tus propias contraseñas.
3. Las extensiones (`btree_gist`, `citext`, `pgcrypto`) las crea la propia migración inicial: son extensiones de confianza y el dueño de la base puede crearlas.
4. Comprueba los roles con `scripts/database/03-verify-setup.sql`.

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

## 3. Migraciones y arranque

```bash
npm install                 # también genera el cliente de Prisma
npm run db:migrate          # aplica las migraciones a la base yoclick (rol yoclick_migrator)
npm run start:dev
curl http://127.0.0.1:3000/health   # {"status":"ok"}
```

## Redis

No hace falta hasta API-3 (lista de espera y recordatorios). Hasta entonces el rate limit va en memoria y la
idempotencia en PostgreSQL, detrás de interfaces para poder cambiarlo sin tocar los casos de uso.

## Tests e2e

`npm run test:e2e` aplica las migraciones a **yoclick_test** y vacía sus tablas entre pruebas. Se niega a ejecutarse si
`TEST_DATABASE_URL` apunta a una base cuyo nombre no termine en `_test`.

## Datos de demo

```bash
npm run db:seed        # idempotente: se puede ejecutar las veces que haga falta
```

Crea los 4 centros ficticios del prototipo y 21 cuentas. **Todas** tienen la misma contraseña de pruebas,
`Nosnibor88` (es pública a propósito; por eso el seed se niega a ejecutarse con `NODE_ENV=production`).

| Centro | Tipo | Color | Código |
|---|---|---|---|
| Studio Norte | estudio | #E4572E | `NORTE7` |
| Forja Readaptación | readap | #2446C7 | `FORJA2` |
| Kiné Lab | box | #C8F031 | `KINE24` |
| Compás Escuela de Baile | baile | #7A3FE0 | `COMPAS` |

Cuentas (sustituye `<centro>` por `studio-norte`, `forja-readaptacion`, `kine-lab` o `compas-escuela-de-baile`):

| Rol | Correo |
|---|---|
| Propietario | `yoclick.owner.<centro>@yopmail.com` |
| Administración | `yoclick.admin.<centro>@yopmail.com` |
| Equipo | `yoclick.staff.<centro>@yopmail.com` |
| Clientes | `yoclick.client1.<centro>@yopmail.com`, `yoclick.client2.<centro>@yopmail.com` |
| Cliente en los 4 centros | `yoclick.multi@yopmail.com` |

## Claves de los tokens

`npm run keys:generate` crea el par de claves Ed25519 de desarrollo y lo añade a `.env` (no toca nada que ya exista).

Los correos son de **Yopmail**: abre https://yopmail.com, escribe la dirección completa y verás los correos reales que
envíe la API (códigos de verificación, recuperación de contraseña). Es un buzón público: no pongas nada sensible en estas cuentas.
Para registrarte con una dirección de Yopmail hace falta `ALLOW_DISPOSABLE_EMAILS=true` en tu `.env` (`npm run keys:generate` lo añade).
