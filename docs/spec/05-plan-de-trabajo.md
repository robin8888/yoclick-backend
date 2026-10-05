# 05 · Plan de trabajo

Un ticket = una rama (`feat/API-012-bookings-create`) = un PR pequeño (< 400 líneas cambiadas sin contar generados). Cada ticket cumple la *definition of done* del `CLAUDE.md` de su repo. Los ids de pantalla (`book3`, `iscan`…) son los del prototipo (`design/pantallas.md`).

Orden recomendado: **API-0 → API-1 → APP-0 en paralelo con API-2 → …** La app trabaja con mocks MSW generados del contrato hasta que el endpoint real existe.

## Estado de avance (5 oct 2026, cierre del día)

Leyenda: ✅ hecho · 🟡 parcial · ⬜ pendiente. Basado en el historial de git de cada repo.

### yoclick-api
- ✅ API-0 Cimientos · ✅ API-1 Identidad (registro, login, refresh rotatorio, recuperar contraseña, 2FA obligatorio para owner/admin, cuenta propia).
- 🟡 API-2 Centros y unirse: unirse por código, búsqueda, branding, alta de centro con prueba y logo, ajustes y equipo con invitaciones (código y enlace) hechos. Falta ubicación en la búsqueda.
- 🟡 API-3 Agenda y reservas: servicios individuales (CRUD y archivado), disponibilidad, reservas con concurrencia (EXCLUDE + cerrojos), cancelación con política, agenda del día, **registro de clase** (iniciar y terminar con temporizador, informe para el propietario) y **asistencia por QR** (`POST /me/checkin-code` con JWT firmado de 5 min y `POST /attendance/check-in`, columnas `checked_in_*`). Falta: clases en grupo y lista de espera, cierre administrativo de una clase sin cerrar, mostrar `checkedInAt` en la reserva.
- ⬜ API-4 Cobros · API-5 Personas, contenido y avisos · API-6 Endurecimiento y salida.

### yoclick-app
- ✅ APP-001 a APP-006 y APP-008. ⬜ APP-007 Storybook.
- 🟡 APP-1 Sistema de diseño: añadidos `SegmentedControl`, `SlotButton`, `DayPill`, `ProgressRing`, `TabBar` (píldora activa, etiqueta en una línea), `AppointmentCard`, `ConfirmSheet`, `QrCard`, `SessionTimerDisplay`, `LogoLoader`, `ChoiceCard`. Faltan SearchBar, KPI, Toast, StepIndicator y plantillas Form/List/Wizard.
- ✅ APP-2 Unirse y autenticación (sin Apple/Google ni E2E Maestro) y APP-9 alta de centro (datos, logo, código para compartir, 2FA del propietario).
- 🟡 APP-3 Cliente: inicio **alineado con el prototipo** (cabecera, «Próxima cita», «Esta semana», «Mi QR de acceso», bono, accesos rápidos), barra Inicio/Reservar/Mis citas/Practicar/Perfil, **Mi QR de acceso** real. Reservar (pasos 1 a 4), «reservada» y «Mis citas» están hechos pero **sin revisar contra el prototipo renderizado**: el usuario indicó que no coinciden.
- 🟡 APP-5 Instructor: agenda, clase con temporizador, **escáner de asistencia**; la agenda sigue sin el estilo del prototipo (`iagenda`, `iclass`).
- 🟡 APP-6 Administración: pestañas Agenda, Registro de clases y **Más** con Servicios y horario (lista, editor, archivar, horario en lectura), Invita a tu equipo e Invita a tus clientes. Falta: Datos del centro (sin campos fiscales en la API), editar horario, Clientes, Marca, equipo con lista de miembros.
- ⬜ APP-4, APP-7, APP-8 y fases 2+ (Practicar y bonos solo como pantallas «muy pronto» o estado vacío).

### Pendientes para mañana, en orden
1. **Revisar con el prototipo renderizado** (`docs/design/prototipo-yoclick.html`, truco: copiar el HTML, cambiar `render();` final por `jump("ID");` y capturar con Edge headless) las pantallas ya construidas: `book1..book4`, `booked`, `appts`, `iagenda`, `iclass`, `aagenda` y la barra del instructor (Agenda, Clientes, Avisos, Perfil). Seguir el prototipo tal cual salvo que el usuario diga otra cosa; fondo blanco.
2. Perfil del alumno real (hoy es un marcador con cerrar sesión) y pestaña «Mis clientes» del instructor.
3. Clases en grupo y lista de espera (el usuario eligió antes las pantallas de administración).
4. Vista de privacidad en el app switcher para el QR (SEC-M6; requiere una dependencia nueva: pedir permiso).
5. Mostrar la llegada (`checkedInAt`) en la agenda del instructor y administración.

### Pendientes transversales (decisiones o acciones tuyas)
- Reiniciar la API en el puerto 3000 tras cada cambio del backend; la migración `20261007090000_add_booking_check_in` ya está aplicada en la base local. `npm run db:seed` restablece las contraseñas demo.
- Si Metro da errores de tipos de rutas, arrancar con `npx expo start --clear` (la caché de rutas tipadas se queda vieja).
- Reinstalar el development build si cambian módulos nativos; id de bundle definitivo, URL de staging y cuentas de Apple y Google (`STORE_CHECKLIST.md`).
- Code signing de EAS Update y gitleaks en el equipo.
- Comprobar en dispositivo el texto al 200 % y los nuevos QR (generar y escanear con dos cuentas).
- Subir cambios con `git push` en los dos repos (los commits son locales hasta entonces).

---

## yoclick-api

### API-0 · Cimientos
| Ticket | Alcance | Aceptación |
|---|---|---|
| API-001 | Repo: Node.js 22 LTS + NestJS 11 + Fastify, TS strict, pnpm, ESLint/Prettier, Vitest, Husky + lint-staged, gitleaks, commitlint | `pnpm lint && pnpm test && pnpm build` en verde en CI |
| API-002 | Docker Compose: Postgres 16, Redis 7, MinIO, Mailpit, Stripe CLI | `docker compose up` + `pnpm dev` levantan la API en `:3000` con `/health` |
| API-003 | Config tipada con zod (falla al arrancar si falta una variable), logger pino con redacción, OpenTelemetry, Sentry | Variables inválidas → el proceso no arranca con mensaje claro |
| API-004 | Prisma ORM + PostgreSQL: `schema.prisma`, Prisma Migrate, roles `yoclick_app` (sin BYPASSRLS) y `yoclick_migrator`, `TenantPrismaService.runInTenantContext()` con `set_config(..., true)`, primera migración con RLS en SQL | Test con Testcontainers: RLS bloquea lecturas cruzadas; un repositorio que use el cliente global falla el lint |
| API-005 | Errores RFC 9457, `ValidationPipe` zod, paginación por cursor, `Idempotency-Key` (Redis), ETag | Tests unitarios de cada helper |
| API-006 | OpenAPI generado (`nestjs-zod` / `@nestjs/swagger`) → `openapi.yaml` commiteado; CI compara y ejecuta `oasdiff` | Cambiar un DTO sin regenerar → CI falla |
| API-007 | Guards: `AuthGuard`, `TenantGuard`, `RolesGuard` deny-by-default + test que recorre rutas | Ruta sin decorador → test falla (SEC-53) |
| API-008 | Seed (`prisma/seed.ts`): 4 centros demo, plantillas de sector, usuarios demo por rol | `pnpm prisma db seed` idempotente |

### API-1 · Identidad
| Ticket | Alcance | Aceptación |
|---|---|---|
| API-101 | Registro + verificación de email + consentimientos | Sin consentimiento de privacidad → `400 CONSENT_REQUIRED` |
| API-102 | Login, refresh rotativo con detección de reutilización, logout | Reusar refresh revocado revoca la familia (test) |
| API-103 | Apple / Google con nonce y JWKS | Tokens con `aud` erróneo → `401` |
| API-104 | Recuperar contraseña (respuesta constante, token de un uso 30 min) | Tiempo de respuesta similar exista o no el email |
| API-105 | MFA TOTP para owner/admin | Admin sin MFA no accede a rutas `/admin` |
| API-106 | `/me`, avatar (URL prefirmada), push tokens, preferencias | — |
| API-107 | Rate limiting (login, forgot, mfa, join) | 11.º intento en 1 min → `429` |
| API-108 | Exportar datos (job) y eliminar cuenta (reauth + anonimización diferida) | JSON contiene todos los datos del usuario y nada de otros |

### API-2 · Centros y unirse
| Ticket | Alcance | Aceptación |
|---|---|---|
| API-201 | Onboarding de centro: crea centro `trial`, owner, servicios sugeridos del sector, código de unión | Pantallas `o1`…`o5`, `osvc`, `overify` y `odone` del prototipo cubiertas |
| API-202 | Branding público (`/branding`), logo (PNG/WebP o SVG saneado) | SVG con `<script>` → rechazado |
| API-203 | Unirse: código, búsqueda geográfica, invitación; límite de clientes del plan | Código inválido → `404 JOIN_CODE_INVALID`; límite → `CLIENT_LIMIT_REACHED` |
| API-204 | Mis centros (`/me/memberships`) | — |
| API-205 | Datos del centro, horario, festivos, política de cancelación (ETag) | `If-Match` viejo → `412` |
| API-206 | Equipo: invitar staff, roles y permisos | Staff no puede invitar admins |

### API-3 · Agenda y reservas
| Ticket | Alcance | Aceptación |
|---|---|---|
| API-301 | Servicios CRUD (editor completo), salas, staff asignado | Sala solapada → aviso de conflicto |
| API-302 | Disponibilidad del staff y ausencias | — |
| API-303 | Cálculo de huecos (`/availability`) con zona horaria del centro, festivos, ausencias, antelación mínima | Tests de tabla con cambio de horario de verano |
| API-304 | Clases en grupo: programar, recurrencia semanal, plazas | — |
| API-305 | Crear reserva (transacción, `for update`, `EXCLUDE`, idempotencia) | 50 peticiones concurrentes por la última plaza → 1 confirmada, 49 `SESSION_FULL`/`waitlisted` |
| API-306 | Cancelar y reprogramar con política (devolución de sesión o dinero) | Fuera de plazo → `withinPolicy=false`, no devuelve sesión |
| API-307 | Lista de espera + promoción automática (job) | Al cancelar, el nº 1 pasa a confirmada y recibe aviso |
| API-308 | Agenda del staff; mover / reasignar / cancelar con aviso | El cliente recibe notificación |
| API-309 | Check-in QR (token Ed25519 60 s, un uso) y pasar lista | Token reutilizado → `409`; de otro centro → `404` |
| API-310 | `.ics` de una reserva | Valida en calendarios iOS y Google |
| API-311 | Familias: reservar para un menor | Tutor ve las reservas del menor; otro cliente no |

### API-4 · Cobros
| Ticket | Alcance | Aceptación |
|---|---|---|
| API-401 | Stripe Connect Express: onboarding del centro, estado de la cuenta | Centro sin KYC completo no puede cobrar online |
| API-402 | Tarifas (bonos, cuotas, matrícula) y sincronización con Stripe Prices | — |
| API-403 | Compra de tarifa (PaymentIntent / Subscription) + webhooks idempotentes | Webhook duplicado no duplica saldo |
| API-404 | Pago al reservar, descuento de bono, monedero, cupones | Saldo insuficiente → `NO_BALANCE` |
| API-405 | Recibos/facturas con IVA, numeración correlativa, PDF | Numeración sin huecos bajo concurrencia |
| API-406 | Reembolsos | — |
| API-407 | Suscripción del centro a Yoclick (Stripe Billing, portal, fin de prueba, impago) | `past_due` → banner en admin; 14 días → `suspended` (solo lectura) |

### API-5 · Personas, contenido y avisos
| Ticket | Alcance |
|---|---|
| API-501 | Clientes: lista, ficha, nivel, notas, grupos |
| API-502 | Salud con cifrado de campo y auditoría |
| API-503 | Importación CSV con previsualización |
| API-504 | Perfiles del staff, subida de vídeo, worker de validación/transcodificación, revisión del centro |
| API-505 | Opiniones verificadas (solo con asistencia) |
| API-506 | Notificaciones: bandeja, push (Expo), correo, recordatorios |
| API-507 | Panel e informes con CSV seguro |
| API-508 | Registro de actividad (`audit_log`) |

### API-6 · Endurecimiento y salida
| Ticket | Alcance |
|---|---|
| API-601 | Revisión SEC-40…75 completa, Semgrep/CodeQL, Trivy |
| API-602 | Pruebas de carga (k6): 200 reservas/min con p95 < 600 ms |
| API-603 | Copias, PITR, prueba de restauración, runbook de incidentes |
| API-604 | Pentest externo y corrección |

---

## yoclick-app

### APP-0 · Cimientos
| Ticket | Alcance | Aceptación |
|---|---|---|
| APP-001 | `create-expo-app` (TS), Expo Router, estructura de carpetas del `CLAUDE.md`, alias `@/`, ESLint/Prettier, Jest + RNTL, Husky, gitleaks | `pnpm lint && pnpm typecheck && pnpm test` en CI |
| APP-002 | `app.config.ts` con entornos y *app variants* (Premium), EAS profiles (`development`, `preview`, `production`) | Build `preview` instalable en iOS y Android |
| APP-003 | Tokens (`design/tokens.json` → `src/shared/theme/tokens.ts`), `brand-engine` con tests de los vectores, `ThemeProvider` claro/oscuro/sistema | Los 3 vectores de `brand-engine.md` pasan |
| APP-004 | Fuentes Archivo + Figtree (`expo-font`), escala tipográfica, soporte de escalado de fuente | Texto a 200 % sin cortes en átomos |
| APP-005 | Cliente API generado con Orval (+ MSW + zod), `apiClient` con auth, `X-Center-Id`, refresh con cola, Idempotency-Key | Un 401 dispara un único refresh aunque haya 5 peticiones en vuelo |
| APP-006 | i18n (es-ES), formateadores (fecha «jue 1 oct», hora 24 h, moneda «12.480 €»), vocabulario de sector `t('staff')` | — |
| APP-007 | Storybook RN con todos los átomos y moléculas en claro y oscuro con 3 marcas | — |
| APP-008 | Estados compartidos: `ScreenSkeleton`, `EmptyState`, `ErrorState`, `OfflineBanner`, `ForceUpdateGate` (pantallas `st*`) | — |

### APP-1 · Sistema de diseño (átomos → organismos)
Átomos: `Text`, `Icon`, `Button` (primary, secondary, outline, ghost, danger; tamaños), `IconButton`, `Avatar` (foto o iniciales), `Badge`/`StatusPill`, `Chip`, `Input`, `Checkbox`, `Switch`, `Radio`, `Divider`, `Skeleton`, `Spinner`, `Logo`.
Moléculas: `FormField`, `SearchBar`, `ListItem`, `SlotButton`, `DayPill`, `ProgressRing`, `KPI`, `ConsentCheckbox`, `Toast`, `SegmentedControl`, `StepIndicator`.
Organismos: `AppointmentCard`, `NextAppointmentCard`, `ServiceCard`, `StaffCard`, `SlotPicker`, `DayStrip`, `BottomSheet`, `ConfirmSheet`, `TabBar`, `Header`, `NotificationItem`, `QrCard`, `QrScanner`, `ClientRow`, `AgendaTimeline`, `RateCard`, `PaymentSummary`.
Plantillas: `ScreenTemplate`, `FormTemplate`, `ListTemplate`, `WizardTemplate`, `TabsTemplate`.

Aceptación de cada componente: historia en Storybook, test RNTL (render, accesibilidad: `accessibilityRole`, `accessibilityLabel`, estado), objetivo táctil ≥ 44, contraste vía tokens, sin colores literales.

### APP-2 · Unirse y autenticación
`jstart`, `jqr`, `jcode`, `jsearch`, `jconfirm`, `welcome`, `login`, `reg1`, `reg2`, recuperar contraseña, Apple/Google, verificación, MFA (admin), `jcenters`. Aceptación: flujo E2E Maestro «unirse con código NORTE7 → registrarse → ver Inicio con marca de Studio Norte».

### APP-3 · Cliente: reservar
`home`, `book1`→`booked`, `appts`, reprogramar, cancelar con política, lista de espera, clases en grupo con plazas, «¿Para quién?», `.ics`, QR de acceso. Aceptación: E2E «reservar, cancelar dentro de plazo, ver la sesión devuelta».

### APP-4 · Cobros
Tarifas, compra con PaymentSheet (tarjeta, Apple Pay, Google Pay), monedero, cupón, pago al reservar, recibos. Aceptación: E2E en modo test de Stripe; la UI no marca «pagado» hasta confirmación del servidor.

### APP-5 · Staff
`iagenda`, `iedit`, escáner QR (`iscan`), pasar lista, disponibilidad y ausencias, ficha de cliente, perfil profesional con subida de vídeo. Aceptación: E2E «escanear QR válido → asistencia marcada; QR caducado → error claro».

### APP-6 · Admin
Panel, servicios (editor completo), tarifas, clientes + importación CSV, grupos, equipo y permisos, invitar (QR, enlace, código, cartel), marca (logo y color con vista previa AA), horario y festivos, revisión de perfiles, informes, seguridad (2FA, actividad), legal, suscripción.

### APP-7 · Onboarding de centro
`overify`, `o1`…`o5`, `osvc`, `odone`: cuenta del propietario, tipo de centro, marca, servicios sugeridos, equipo, plan y prueba.

### APP-8 · Perfil, privacidad, avisos
`profile`, foto (cámara/galería, recorte 240 px), datos, consentimientos, notificaciones y preferencias, exportar datos, eliminar cuenta (escribir ELIMINAR), ayuda, tema.

### APP-9 · Endurecimiento y salida
Revisión SEC-01…37, Privacy Manifest y Data Safety, pinning, integridad (App Attest / Play Integrity) en escáner y pagos, accesibilidad con VoiceOver y TalkBack, rendimiento (arranque < 2,5 s), Maestro en CI, fichas de tienda, build Premium de un centro piloto.

---

## Hitos

| Hito | Contenido | Señal de terminado |
|---|---|---|
| H1 · Esqueleto | API-0, API-1, APP-0, APP-1 | Login real en la app contra staging |
| H2 · Reservar | API-2, API-3, APP-2, APP-3, APP-5 (agenda + QR) | Un centro piloto reserva y pasa lista sin papel |
| H3 · Cobrar | API-4, APP-4 | Primer cobro real en modo live con un centro |
| H4 · Gestionar | API-5, APP-6, APP-7, APP-8 | Un centro se da de alta solo y opera una semana |
| H5 · Lanzar | API-6, APP-9 | Pentest cerrado, apps aprobadas en tiendas |
