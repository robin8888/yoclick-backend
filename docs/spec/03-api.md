# 03 · API

REST sobre HTTPS, JSON, prefijo `/v1`. El contrato canónico es `openapi.yaml` generado por el backend; este documento define convenciones y el mapa de endpoints del MVP.

## Convenciones

| Tema | Regla |
|---|---|
| Nombres | Recursos en inglés, plural, `kebab-case`: `/v1/class-sessions`. Campos JSON en `camelCase`. |
| Tenant | Cabecera `X-Center-Id: <uuid>` en toda ruta de centro. El `TenantGuard` verifica la membresía. Las rutas `/v1/me/*` y `/v1/join/*` no la llevan. |
| Auth | `Authorization: Bearer <access JWT>`. Sin cookies en la app. |
| Fechas | ISO 8601 con zona (`2026-10-01T18:00:00+02:00`). La API devuelve UTC y `center.timezone`. |
| Dinero | `{ "amountCents": 3500, "currency": "EUR" }` |
| Paginación | Por cursor: `?limit=20&cursor=…` → `{ data: [], nextCursor: string \| null }`. `limit` máx. 100. |
| Filtros | Lista blanca explícita por endpoint (`?from=&to=&staffId=`). Nunca filtros genéricos. |
| Idempotencia | `Idempotency-Key: <uuid>` **obligatoria** en `POST` de reservas, pagos, cancelaciones y compras. Se guarda 24 h con la respuesta. |
| Concurrencia | `ETag` / `If-Match` en ediciones de servicios, centro y perfil → `412` si cambió. |
| Versionado | Cambios compatibles en `/v1`; incompatibles en `/v2`. Cabecera `X-Min-App-Version` en respuestas → la app muestra «Actualización obligatoria» (pantalla `stupd`). |
| Rate limit | Cabeceras `RateLimit-*` (IETF). `429` con `Retry-After`. |

## Errores (RFC 9457 Problem Details)

```json
{
  "type": "https://api.yoclick.app/errors/slot-unavailable",
  "title": "Esa hora ya no está disponible",
  "status": 409,
  "code": "SLOT_UNAVAILABLE",
  "detail": "Otra persona acaba de reservar las 18:00.",
  "traceId": "01J…",
  "errors": [{ "path": "startsAt", "code": "taken" }]
}
```

- `code` estable en MAYÚSCULAS; la app traduce por `code`, no por `title`.
- Nunca stack traces, SQL ni ids internos de terceros en producción.
- `404` (no `403`) cuando el recurso existe pero es de otro centro o de otro cliente (no revelar existencia).

Códigos de negocio mínimos: `SLOT_UNAVAILABLE`, `SESSION_FULL`, `ALREADY_BOOKED`, `OUTSIDE_BOOKING_WINDOW`, `CANCEL_OUT_OF_POLICY` (informativo), `NO_BALANCE`, `PAYMENT_REQUIRED`, `PAYMENT_FAILED`, `CLIENT_LIMIT_REACHED`, `JOIN_CODE_INVALID`, `MEMBERSHIP_BLOCKED`, `CONSENT_REQUIRED`, `MFA_REQUIRED`, `CHECKIN_TOKEN_EXPIRED`, `CHECKIN_WRONG_SESSION`, `APP_VERSION_UNSUPPORTED`.

## Endpoints MVP

Leyenda de rol: **P** público · **U** usuario autenticado · **C** cliente del centro · **S** staff · **A** admin/owner.

### Auth (`/v1/auth`)

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| POST | `/auth/register` | P | Email, contraseña, nombre, consentimientos (privacy obligatorio). Envía verificación. |
| POST | `/auth/login` | P | → `{ accessToken, refreshToken, mfaRequired? }` |
| POST | `/auth/oauth/apple` · `/auth/oauth/google` | P | Verifica `identityToken` / `idToken` contra JWKS del proveedor (aud, iss, exp, nonce) |
| POST | `/auth/mfa/verify` | P (token MFA) | TOTP |
| POST | `/auth/refresh` | P | Rotación; reutilización ⇒ revoca la familia |
| POST | `/auth/logout` | U | Revoca el refresh actual (o todos con `?all=true`) |
| POST | `/auth/password/forgot` · `/auth/password/reset` | P | Respuesta idéntica exista o no el email |
| POST | `/auth/email/verify` | P | — |

### Yo (`/v1/me`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET/PATCH | `/me` | Perfil, idioma |
| POST | `/me/avatar/upload-url` | URL prefirmada (PUT, `image/jpeg\|png\|webp`, ≤ 5 MB, 5 min) |
| GET | `/me/memberships` | «Mis centros» con branding resumido |
| GET | `/me/minors` · POST `/me/minors` | Familias |
| GET/PUT | `/me/consents` | Ver y cambiar consentimientos opcionales |
| GET/PUT | `/me/notification-prefs` | — |
| POST/DELETE | `/me/push-tokens` | — |
| POST | `/me/data-export` | Job asíncrono → enlace de descarga JSON por email (RGPD art. 15/20) |
| DELETE | `/me` | Eliminar cuenta (requiere reautenticación reciente; Apple 5.1.1(v)) |

### Unirse (`/v1/join`)

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| GET | `/join/code/{code}` | P | Centro por código (rate limit estricto: 10/min/IP) |
| GET | `/join/search?q=&lat=&lng=` | P | Búsqueda (solo centros con `listed = true`) |
| GET | `/join/invitations/{token}` | P | Datos de la invitación |
| POST | `/join/{centerId}` | U | Crea membresía `client` (comprueba límite del plan → `CLIENT_LIMIT_REACHED`) |

### Centro (`/v1/centers/{centerId}` + `X-Center-Id`)

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| GET | `/branding` | P | Nombre, logo, color, sector, vocabulario (cacheable) |
| GET/PATCH | `/` | A | Datos, horario, festivos, política de cancelación |
| POST | `/logo/upload-url` | A | SVG **no** se acepta crudo: PNG/WebP, o SVG saneado en servidor |
| GET | `/services` | C | Servicios visibles |
| POST/PATCH/DELETE | `/services[/{id}]` | A | Editor completo; DELETE = archivar |
| GET | `/staff` | C | Equipo público (perfiles publicados) |
| GET | `/staff/{membershipId}/profile` | C | Perfil público, vídeos, opiniones |
| GET | `/availability?serviceId=&staffId=&from=&to=` | C | Huecos libres calculados en servidor |
| GET | `/class-sessions?from=&to=` | C | Calendario de clases en grupo con plazas |
| POST/PATCH | `/class-sessions[/{id}]` | A·S | Programar, mover, cancelar (avisa a los clientes) |

### Reservas

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| POST | `/bookings` | C | `{ serviceId, staffId?, startsAt \| sessionId, bookedForUserId?, payWith: 'rate'\|'wallet'\|'card'\|'onsite', clientRateId?, couponCode? }` → `201` confirmada, `202` en lista de espera, `402 PAYMENT_REQUIRED` con `clientSecret` |
| GET | `/bookings?scope=upcoming\|past` | C | Mis citas (y las de mis menores) |
| GET | `/bookings/{id}` | C·S | — |
| POST | `/bookings/{id}/reschedule` | C·S | — |
| POST | `/bookings/{id}/cancel` | C·S·A | Devuelve el resultado de la política (`withinPolicy`, `refund`, `sessionReturned`) |
| GET | `/bookings/{id}/ics` | C | Archivo .ics |
| GET | `/bookings/{id}/checkin-token` | C | Token QR firmado, vida 60 s, se rota en la app |
| POST | `/checkins` | S | `{ token, sessionId }` → valida firma, caducidad, sesión, centro y que no se haya usado |
| POST | `/class-sessions/{id}/attendance` | S | Pasar lista manual |

### Staff

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| GET | `/staff/me/agenda?date=` | S | Agenda del día |
| GET/PUT | `/staff/me/availability` · `/staff/me/absences` | S | — |
| GET/PATCH | `/staff/me/profile` | S | Bio, especialidades, titulaciones |
| POST | `/staff/me/media/upload-url` | S | Vídeo `video/mp4\|quicktime`, ≤ 200 MB, ≤ 3 min; worker valida y transcodifica |
| POST | `/staff/{membershipId}/profile/review` | A | Publicar o rechazar |

### Clientes (gestión)

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| GET | `/clients?q=&groupId=&cursor=` | S·A | Lista (campos mínimos) |
| GET/PATCH | `/clients/{membershipId}` | S·A | Ficha; nivel, grupos |
| GET/POST | `/clients/{id}/notes` | S·A | — |
| GET/PUT | `/clients/{id}/health` | S con `health:read` | Auditado |
| POST | `/clients/import` | A | CSV ≤ 2 MB, ≤ 2.000 filas, validado fila a fila, previsualización antes de confirmar |
| POST | `/invitations` | A | Invitar cliente o staff |
| GET/POST/PATCH | `/groups[...]` | A | — |
| GET/POST/PATCH | `/team[...]` | A | Roles y permisos |

### Cobros

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| GET | `/rates` | C | Tarifas a la venta |
| POST/PATCH | `/rates[/{id}]` | A | — |
| POST | `/rates/{id}/purchase` | C | → PaymentIntent / Subscription (`clientSecret`) |
| GET | `/me/balance` | C | Bonos, monedero |
| GET | `/payments` · `/invoices/{id}/pdf` | C (propios) · A | — |
| POST | `/payments/{id}/refund` | A | — |
| POST | `/stripe/connect/onboarding-link` | A | Alta de la cuenta Stripe del centro |
| POST | `/webhooks/stripe` | P (firma) | Verifica `Stripe-Signature`, idempotente por `event.id` |

### Admin, informes, onboarding

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| POST | `/v1/onboarding/centers` | U | Alta de centro: crea centro (`trial`), membresía `owner`, servicios sugeridos del sector |
| GET | `/dashboard` | A | KPIs del día |
| GET | `/reports/{kind}?from=&to=&format=json\|csv` | A | Ocupación, ingresos, asistencia. CSV con neutralización de fórmulas (`=`, `+`, `-`, `@` → prefijo `'`) |
| GET | `/audit-log` | A | Registro de actividad |
| GET/POST | `/subscription` · `/subscription/portal` | A | Plan de Yoclick (Stripe Billing Customer Portal) |

## Jobs (BullMQ)

| Cola | Disparo | Qué hace |
|---|---|---|
| `reminders` | 24 h y 2 h antes | Push + correo |
| `waitlist` | Al cancelar | Promueve al nº 1, avisa; si no hay saldo, reserva retenida 15 min |
| `notifications` | Cambios del staff | «Álex Moreno ha cambiado tu cita…» |
| `media` | Subida terminada | Validar magic bytes, duración, transcodificar, miniatura, borrar original |
| `exports` | `data-export`, informes grandes | Genera, sube con URL de 24 h |
| `trial` | Diario | Avisos de fin de prueba, suspensión |
| `account-deletion` | Diario | Anonimiza cuentas tras 30 días |
