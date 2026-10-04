# CLAUDE.md · yoclick-api

Backend multi-centro de Yoclick: **Node.js 22 LTS + NestJS 11 (Fastify) + TypeScript strict + Prisma ORM + PostgreSQL 16+ (RLS)** + Redis/BullMQ + Stripe Connect. Lee esto entero antes de cada tarea. Especificación en `docs/spec/` (empieza por `01-arquitectura.md` sección «Prisma y RLS», `02-modelo-de-datos.md`, `03-api.md`, `04-seguridad.md`, `06-clean-code.md`); plan en `docs/spec/05-plan-de-trabajo.md`.

## Comandos

```bash
npm install
# PostgreSQL 17 local (bases yoclick y yoclick_test); Redis llega con API-3 (sin Docker)
npx prisma migrate dev     # aplica migraciones en local (usa MIGRATION_DATABASE_URL)
npx prisma db seed         # seed demo idempotente
npx prisma generate        # regenera el cliente tipado (también en postinstall)
npm run start:dev                 # API en :3000, docs en /docs (solo no-prod)
npm run worker                 # workers BullMQ
npm run lint && npm run typecheck
npm run test                   # unit (Jest)
npm run test:e2e               # Supertest contra Postgres real (base yoclick_test)
npm run openapi:gen            # regenera openapi.yaml (CI comprueba que está al día)
```

Antes de dar una tarea por terminada: `npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run openapi:gen` sin diferencias.

## Arquitectura

Monolito modular con capas por módulo (hexagonal ligera). Un módulo por contexto: `auth`, `users`, `centers`, `join`, `team`, `services`, `scheduling` (disponibilidad, sesiones), `bookings`, `attendance`, `payments`, `invoicing`, `clients`, `health`, `staff-profiles`, `media`, `notifications`, `reports`, `audit`, `platform`.

```
src/modules/<module>/
  domain/          entidades y value objects (Money, TimeRange, BookingStatus), reglas puras, errores de dominio
  application/     casos de uso (una clase por caso: CreateBookingUseCase), puertos (interfaces de repos y servicios)
  infrastructure/  repositorios Prisma (prisma-booking.repository.ts), adaptadores (Stripe, S3, Push, Mail)
  http/            controllers, DTOs zod (entrada y salida), mappers dominio→DTO
  <module>.module.ts
src/shared/        tenancy, auth, errors (RFC 9457), pagination, idempotency, crypto, audit, config, logger
src/shared/database/ PrismaService, TenantPrismaService (RLS), tipos de transacción
prisma/            schema.prisma, migrations/ (con SQL de RLS y EXCLUDE añadido), sql/ (TypedSQL), seed.ts
prisma.config.ts   configuración de Prisma (URL, rutas de esquema y migraciones)
src/jobs/          workers BullMQ
```

Reglas:

- `domain/` no importa Nest, Prisma ni nada de infraestructura. `@prisma/client` / el cliente generado solo se importa en `infrastructure/` y `shared/database/`; los repositorios mapean modelos Prisma a entidades de dominio. Se testea con unit tests puros.
- Controllers finos: validan (zod), llaman a **un** caso de uso, mapean a DTO de salida. Sin lógica de negocio.
- Los casos de uso reciben un `ActorContext` `{ userId, centerId, membershipId, role, permissions }` explícito.
- Comunicación entre módulos por casos de uso o eventos de dominio (EventEmitter → BullMQ), nunca accediendo a tablas de otro módulo.
- Dinero con value object `Money` en céntimos; nunca `number` de euros con decimales.
- Fechas en UTC; conversión a la zona del centro solo en el cálculo de disponibilidad y en las salidas formateadas (usar `Temporal` polyfill o `date-fns-tz`).

## Multi-tenant (crítico)

1. `TenantGuard` lee `X-Center-Id`, carga la membresía activa del usuario en ese centro y construye `ActorContext`. Sin membresía → `404`.
2. Toda operación de BD de una petición pasa por `tenantPrismaService.runInTenantContext(actorContext, async (transactionClient) => …)`, que abre `prisma.$transaction` y ejecuta con `$executeRaw` parametrizado `select set_config('app.center_id', ${centerId}, true)` (y `app.user_id`, `app.membership_id`, `app.role`). Los repositorios reciben ese `transactionClient`; usar el `PrismaClient` global para datos de un centro está prohibido (regla de lint).
3. Toda tabla con `center_id` tiene `enable` + `force row level security` y política `tenant_isolation` (ver `docs/spec/02-modelo-de-datos.md`). Prisma no modela RLS: crea la migración con `prisma migrate dev --create-only` y añade al `migration.sql` el `enable/force row level security`, las políticas, `btree_gist` y las restricciones `EXCLUDE`.
4. `DATABASE_URL` (runtime) usa el rol `yoclick_app`: sin `BYPASSRLS`, sin propiedad de tablas, sin DDL. `MIGRATION_DATABASE_URL` usa `yoclick_migrator` y solo se usa en local y en CI/CD (`prisma migrate deploy`).
5. **Además** de RLS, cada caso de uso comprueba propiedad/rol (`assertCanAccess`). RLS es la red, no la única defensa.
6. Cada endpoint nuevo añade casos a `test/e2e/tenancy.e2e.spec.ts` (centro A ≠ B) y `test/e2e/bola.e2e.spec.ts` (cliente X ≠ Y).

## Seguridad (OWASP API Security Top 10 2023) — obligatorio

Controles `SEC-40…75` en `docs/spec/04-seguridad.md`. Resumen operativo:

- **API1 BOLA**: cargar recursos siempre por `(id, center_id)` + propietario o rol; responder `404` si no corresponde.
- **API2 Auth**: argon2id; JWT EdDSA 10 min con `aud/iss/exp/jti` y `kid`; refresh opaco rotativo con detección de reutilización; MFA para owner/admin; rate limit en login/forgot/mfa/join.
- **API3 BOPLA**: DTOs de entrada `z.object({...}).strict()` por caso de uso; DTOs de salida por rol. Prohibido `Object.assign(entity, body)` o `...body` hacia la BD.
- **API4 Recursos**: límites de cuerpo (1 MB), `limit ≤ 100`, rangos de fechas acotados, `statement_timeout`, cuotas de subida por plan, URLs prefirmadas con tamaño y tipo firmados.
- **API5 BFLA**: `@Roles()`/`@Permissions()` deny-by-default; test que falla si una ruta no tiene decorador de autorización (o `@Public()` explícito).
- **API6 Flujos sensibles**: límites de reservas activas, ventanas, cupones de un uso, check-in de un uso y 60 s, alta de centros con verificación y límites.
- **API7 SSRF**: la API no descarga URLs de usuarios.
- **API8 Configuración**: cabeceras seguras, `no-store`, CORS solo `yoclick-web`, sin Swagger en prod, contenedor no root, errores RFC 9457 sin detalles internos.
- **API9 Inventario**: `openapi.yaml` al día; ruta no documentada → CI falla; `X-Min-App-Version`.
- **API10 Terceros**: webhooks Stripe con firma, tolerancia y idempotencia por `event.id`; JWKS de Apple/Google verificados; respuestas de terceros validadas con zod; timeouts.

Además:

- Secretos solo por variables de entorno validadas con zod; nunca en el repo (gitleaks en pre-commit y CI).
- Logs pino con `redact` (`authorization`, `password`, `token`, `email`, `phone`, `*.health*`). Nunca loguear cuerpos de petición.
- Datos de salud y secretos MFA cifrados a nivel de campo (AES-256-GCM, envelope con KMS). Acceso a salud → `audit_log`.
- SQL solo con la API de Prisma, `$queryRaw`/`$executeRaw` con *tagged template* o TypedSQL (`prisma/sql/*.sql`). Prohibidos `$queryRawUnsafe`, `$executeRawUnsafe` y `Prisma.raw` con datos de usuario.
- CSV exportado: neutralizar fórmulas (`=`, `+`, `-`, `@`, tab, CR al inicio → prefijo `'`).
- SVG de logos: rechazar o sanear (DOMPurify en servidor con perfil SVG), servir con `Content-Type` correcto y `Content-Disposition` adecuado.

## Reservas: invariantes que nunca se rompen

- Sin solapes de staff ni de sala (restricción `EXCLUDE` en BD).
- Plazas: `select … for update` de la sesión (TypedSQL o `$queryRaw`) dentro de la misma transacción interactiva de Prisma; nunca contar fuera de la transacción. Transacciones con `isolationLevel` y `timeout` explícitos.
- Idempotencia obligatoria en crear/cancelar/reprogramar/pagar.
- Saldo de bonos y monedero como **libro mayor** (`balance_movements`, solo inserts); el saldo es la suma o un campo actualizado en la misma transacción.
- Un pago solo es `succeeded` cuando lo dice el webhook de Stripe (re-consultado), nunca por lo que diga la app.

## OpenAPI

- DTOs zod → OpenAPI 3.1 (`nestjs-zod` o `@anatine/zod-openapi`). Cada endpoint con `operationId` estable (`bookings_create`), tags por módulo, ejemplos y respuestas de error.
- `openapi.yaml` commiteado en la raíz; CI: regenerar y `git diff --exit-code`; `oasdiff breaking` contra la última release.
- Cambios incompatibles → nueva versión o periodo de compatibilidad con `Deprecation`/`Sunset`.

## Tests

- **Unit** (`domain/`, `application/` con repos en memoria): Jest, tablas de casos. Cobertura ≥ 90 % en `domain/`.
- **E2E**: Supertest contra la app Nest con Postgres real (base de datos yoclick_test), migraciones y RLS aplicadas.
- Obligatorios por endpoint: feliz, validación (`400`), no autenticado (`401`), otro centro (`404`), otro cliente (`404`), rol insuficiente (`403`/`404`), idempotencia si aplica.
- Concurrencia: test de la última plaza con 50 peticiones en paralelo.
- Webhooks: firma inválida, evento duplicado, evento fuera de orden.

## Nombres y clean code

Reglas completas en `docs/spec/06-clean-code.md` (las hace cumplir ESLint). Lo esencial:

- Nombres que explican qué es o qué hace, en inglés y sin abreviaturas: `calculateAvailableSlots`, `isWithinCancellationWindow`, `remainingSessionCount`, `PrismaBookingRepository`. Prohibidos `data`, `res`, `tmp`, `obj`, `item2`, `handle`, `process`, `utils.ts`.
- Booleanos con `is/has/can/should`; constantes con unidad (`ACCESS_TOKEN_TTL_SECONDS`, `MAX_UPLOAD_SIZE_BYTES`); campos con unidad (`durationMinutes`, `priceCents`).
- Usa siempre el glosario de dominio (`Center`, `Membership`, `ClassSession`, `Booking`, `Rate`, `ClientRate`, `ActorContext`).
- Ficheros con la convención de Nest y nombre descriptivo: `create-booking.use-case.ts`, `prisma-booking.repository.ts`, `booking-response.dto.ts`.
- Funciones ≤ 40 líneas (objetivo 20), ≤ 3 parámetros (si no, objeto con nombre), sin flags booleanos, retornos tempranos, profundidad ≤ 3.
- TS strict, `noUncheckedIndexedAccess`, sin `any`, sin `!` no justificado; tipos de retorno explícitos en lo exportado.
- Errores de dominio tipados (`SlotUnavailableError`) mapeados a RFC 9457 en un filtro global; nunca `throw new Error('…')` genérico en dominio ni `catch {}` vacío.
- Comentarios solo para el porqué. Sin código comentado ni `console.log`.
- Mensajes al usuario en español en `src/shared/errors/catalog.es.ts` por `code`.
- Tests con nombres que describen el comportamiento: `it('returns SESSION_FULL when the last seat was taken concurrently')`.
- Conventional Commits; PR pequeño con id de ticket (`API-305`) y controles SEC citados.

## Definition of done

- [ ] Caso de uso con tests unitarios; endpoint con e2e (incluidos tenancy y BOLA).
- [ ] `schema.prisma` actualizado, migración generada y SQL de RLS/política añadido si hay tabla nueva; `prisma migrate diff` sin derivas.
- [ ] `openapi.yaml` regenerado y sin breaking changes no intencionados.
- [ ] Controles SEC aplicables revisados y citados en el PR.
- [ ] Logs sin PII; errores RFC 9457 con `code` del catálogo.
- [ ] Seed actualizado si la feature lo necesita para la demo.

## Lo que NO debes hacer

- No usar el `PrismaClient` global fuera de `shared/database/` ni devolver modelos de Prisma desde los casos de uso.
- No editar a mano el cliente generado de Prisma ni migraciones ya aplicadas en staging/producción.

- No usar el rol propietario de la BD en la app ni `BYPASSRLS`.
- No aceptar `centerId` del cuerpo de la petición.
- No exponer ids de Stripe, hashes ni notas internas a clientes.
- No guardar tarjetas (Stripe las tokeniza; Yoclick nunca ve el PAN).
- No construir funciones F2+ salvo que el ticket lo pida.
