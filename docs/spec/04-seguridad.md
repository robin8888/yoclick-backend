# 04 · Seguridad y privacidad

Referencias: **OWASP Mobile Top 10 (2024)**, **OWASP API Security Top 10 (2023)**, **OWASP MASVS v2** (nivel L1 para todo; controles L2 seleccionados para salud y pagos), **ASVS 4.0.3 nivel 2** para la API, RGPD + LOPDGDD.

Cada control tiene un id (`SEC-xx`) que los PR citan. Un ticket no está terminado si rompe un control de esta lista.

## A · App móvil — OWASP Mobile Top 10 2024

### M1 · Uso inadecuado de credenciales
- **SEC-01** Cero secretos en el bundle: ni claves de Stripe secretas, ni API keys privadas, ni credenciales de S3. Solo la *publishable key* de Stripe y la URL de la API vía `app.config.ts` → `extra` (`EXPO_PUBLIC_*` se considera **público**).
- **SEC-02** `gitleaks` en pre-commit y CI en los dos repos.
- **SEC-03** Tokens de sesión solo en `expo-secure-store` con `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Nunca en AsyncStorage, MMKV sin cifrar, Zustand persistido ni logs.
- **SEC-04** Access token solo en memoria; el refresh en SecureStore. Al cerrar sesión: borrar ambos, `queryClient.clear()`, borrar caché de imágenes del usuario.

### M2 · Seguridad insuficiente de la cadena de suministro
- **SEC-05** `pnpm` con lockfile commiteado, `pnpm install --frozen-lockfile` en CI; Renovate semanal agrupado; `pnpm audit --prod` y `osv-scanner` bloquean en severidad alta.
- **SEC-06** Lista blanca de dependencias: añadir una librería requiere justificar en el PR (mantenimiento, descargas, licencia MIT/Apache/BSD, sin scripts `postinstall` sospechosos).
- **SEC-07** Builds solo en EAS con credenciales gestionadas por EAS; firma de Android con Play App Signing. SBOM (CycloneDX) generado en cada release.
- **SEC-08** OTA (EAS Update) con *code signing* de actualizaciones activado y `runtimeVersion` por política `fingerprint`.

### M3 · Autenticación / autorización inseguras
- **SEC-09** La app **nunca decide permisos**: oculta UI según rol por usabilidad, pero toda autorización la hace la API.
- **SEC-10** Biometría (`expo-local-authentication`) solo como desbloqueo local del refresh token, nunca como sustituto de la auth del servidor.
- **SEC-11** Sign in with Apple obligatorio si se ofrece Google (Apple 4.8). Usar `nonce` (SHA-256) en ambos.
- **SEC-12** Reautenticación (contraseña o biometría + refresh reciente < 5 min) para: eliminar cuenta, cambiar email/contraseña, ver datos de salud, exportar datos, cambiar cuenta bancaria del centro.
- **SEC-13** Deep links / universal links: validar dominio (Associated Domains / `assetlinks.json`), parsear con zod, nunca ejecutar acciones destructivas solo por abrir un enlace (las invitaciones muestran confirmación).

### M4 · Validación insuficiente de entradas / salidas
- **SEC-14** Todos los formularios con zod (mismo esquema que el generado de OpenAPI cuando exista).
- **SEC-15** Toda respuesta de la API se valida con zod en el cliente generado (Orval `zod` output) en desarrollo y en los endpoints críticos en producción.
- **SEC-16** Sin `WebView` con HTML de terceros. Si se necesita (p. ej. texto legal), `originWhitelist` estricta, `javaScriptEnabled=false` salvo necesidad, sin `injectedJavaScript` con datos de usuario.
- **SEC-17** El contenido de QR escaneado es **no confiable**: el escáner del instructor solo acepta el formato `yoclick:checkin:<jwt>` y lo envía a la API; nunca abre URLs.
- **SEC-18** Texto de usuario (bio, notas, nombres) se renderiza como texto, nunca como HTML/Markdown sin sanear.

### M5 · Comunicación insegura
- **SEC-19** Solo HTTPS (TLS 1.2+). iOS ATS sin excepciones; Android `usesCleartextTraffic=false` y `network_security_config` sin `user` CAs en release.
- **SEC-20** *Certificate pinning* (pin de clave pública con pin de respaldo) para el dominio de la API en release, con plan de rotación documentado. Evaluar en el ticket de hardening (riesgo de bloqueo); obligatorio antes de activar datos de salud en producción.
- **SEC-21** Nada sensible en query strings (tokens, emails). Nada sensible en notificaciones push (texto genérico: «Tienes un cambio en tu cita»).

### M6 · Controles de privacidad inadecuados
- **SEC-22** Minimización: la app solo pide permisos en el momento de uso, con texto explicativo (`NSCameraUsageDescription`, ubicación «cuando se usa» solo para buscar centros).
- **SEC-23** Consentimientos separados, desmarcados por defecto; salud e imagen siempre explícitos; menores < 14 con consentimiento del tutor.
- **SEC-24** Privacy Manifest de iOS (`PrivacyInfo.xcprivacy`) y Data Safety de Google Play coherentes con lo que se recoge. Sin SDKs de publicidad ni de *tracking*; si se añade analítica, sin IDFA y con consentimiento.
- **SEC-25** Logs y Sentry con `beforeSend` que elimina email, teléfono, nombres, tokens, cuerpos de petición y datos de salud.
- **SEC-26** Exportar mis datos y eliminar cuenta accesibles desde la app (Ajustes › Privacidad).
- **SEC-27** Ocultar contenido sensible en el *app switcher* (pantallas de salud, pagos, QR): vista de privacidad al pasar a segundo plano.

### M7 · Protección binaria insuficiente
- **SEC-28** Hermes bytecode en release (no JS plano), `minifyEnabled` + R8 en Android, sin `console.*` en producción (babel plugin), sin source maps en el binario (se suben a Sentry).
- **SEC-29** Detección de root/jailbreak y depuración (p. ej. `jail-monkey` o Play Integrity / App Attest): **avisar y registrar**, no bloquear, salvo en el escáner de asistencia del staff y en pagos, donde se exige verificación de integridad (App Attest / Play Integrity verificada en servidor) — fase de hardening.

### M8 · Configuración de seguridad incorrecta
- **SEC-30** `android:allowBackup="false"` (o reglas de *backup* que excluyan SecureStore y cachés), `android:debuggable=false`, componentes no exportados salvo los necesarios.
- **SEC-31** Variables por entorno con `app.config.ts`; build de producción falla si apunta a una API que no es `https://api.yoclick.app`.
- **SEC-32** Pantallas de depuración / menús de desarrollo excluidos del build de producción.

### M9 · Almacenamiento de datos inseguro
- **SEC-33** Caché de TanStack Query **no persistida** para datos personales; si se persiste algo (catálogo de servicios, branding), solo datos públicos.
- **SEC-34** Ficheros temporales (foto recortada, .ics, exportes) en `cacheDirectory` y borrados tras usarse.
- **SEC-35** El portapapeles no recibe datos sensibles salvo acción explícita (copiar código de invitación).

### M10 · Criptografía insuficiente
- **SEC-36** No implementar criptografía propia en la app. Aleatoriedad con `expo-crypto` (`getRandomBytes`, `randomUUID`) para `Idempotency-Key` y `nonce`.
- **SEC-37** El QR de asistencia lo firma el servidor (Ed25519) — la app solo lo muestra.

## B · API — OWASP API Security Top 10 2023

### API1 · BOLA (autorización a nivel de objeto)
- **SEC-40** Todo caso de uso que recibe un id carga el recurso **filtrado por `center_id` y por propietario** (o comprueba rol staff/admin). Helper obligatorio `assertCanAccess(actor, resource)`.
- **SEC-41** RLS en todas las tablas con `center_id` (ver `02-modelo-de-datos.md`) + test e2e «centro A no ve B» y «cliente X no ve reservas de cliente Y» por endpoint.
- **SEC-42** Ids UUIDv7 (no secuenciales); aun así, nunca se confía en que sean secretos.

### API2 · Autenticación rota
- **SEC-43** Contraseñas: argon2id (m=19 MiB, t=2, p=1 mínimo), longitud ≥ 10, comprobación contra contraseñas filtradas (HIBP k-anonymity), sin reglas de composición absurdas.
- **SEC-44** JWT de acceso EdDSA, 10 min, `aud`, `iss`, `exp`, `jti`; claves rotables (JWKS interno con `kid`). Rechazar `alg: none` y algoritmos no esperados.
- **SEC-45** Refresh opaco rotativo con detección de reutilización; revocación por dispositivo y global.
- **SEC-46** Rate limit y bloqueo progresivo en login, forgot, MFA y `join/code` (por IP y por cuenta). Mensajes genéricos («Email o contraseña incorrectos»).
- **SEC-47** MFA TOTP obligatorio para `owner`, `admin` y superadmin.

### API3 · BOPLA (autorización a nivel de propiedad)
- **SEC-48** DTOs de entrada **explícitos** por caso de uso (zod `strict()`): nunca `Object.assign(entity, body)`. Un cliente no puede enviar `role`, `centerId`, `status`, `priceCents`, `remainingSessions`.
- **SEC-49** DTOs de salida por rol (mappers): el cliente nunca recibe `password_hash`, notas internas, salud de otros, `stripe_*` ids, emails de otros clientes.

### API4 · Consumo de recursos sin restricción
- **SEC-50** Rate limit global (Redis) y por ruta; límites de tamaño de cuerpo (1 MB JSON), de `limit` (100), de rango de fechas (máx. 62 días en disponibilidad).
- **SEC-51** Subidas por URL prefirmada con `Content-Length` y `Content-Type` firmados; validación de *magic bytes* en worker; cuotas por centro según plan.
- **SEC-52** Timeouts en BD (`statement_timeout` 5 s) y en llamadas a terceros.

### API5 · BFLA (autorización a nivel de función)
- **SEC-53** Guard `@Roles()` + `@Permissions()` **deny by default**: una ruta sin decorador de autorización falla en el arranque (test que recorre el router).
- **SEC-54** Rutas de admin y superadmin en módulos separados, con prefijo y guard propios.

### API6 · Acceso sin restricción a flujos de negocio sensibles
- **SEC-55** Reservas: máximo de reservas activas por cliente y servicio, ventana de reserva, antelación mínima; detección de reservas/cancelaciones en bucle.
- **SEC-56** Lista de espera y cupones: un uso por cliente, límites por cupón, sin enumeración de códigos.
- **SEC-57** Alta de centros: verificación de email, CAPTCHA invisible (Turnstile) en web, límite por IP; la prueba no permite cobrar hasta completar Stripe Connect (KYC de Stripe).
- **SEC-58** Check-in: token de un solo uso, 60 s, ligado a la reserva y la sesión; el staff solo puede escanear sesiones de su centro y de hoy.

### API7 · SSRF
- **SEC-59** La API **no descarga URLs** proporcionadas por usuarios. El logo y los vídeos se suben a S3 por URL prefirmada; no hay «importar desde URL». Si en el futuro hiciera falta: lista blanca de hosts, bloqueo de IPs privadas/link-local, sin redirecciones.

### API8 · Configuración de seguridad incorrecta
- **SEC-60** Cabeceras: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` en respuestas autenticadas; CORS solo para los orígenes de `yoclick-web` (la app no necesita CORS).
- **SEC-61** Errores RFC 9457 sin detalles internos; Swagger UI deshabilitado en producción.
- **SEC-62** Contenedor *distroless* / no root, sistema de ficheros de solo lectura, imagen escaneada con Trivy.
- **SEC-63** Rol de BD de la app (`DATABASE_URL` de Prisma) sin `BYPASSRLS`, sin DDL; migraciones con otro rol solo desde CI/CD; prohibidos `$queryRawUnsafe` y `$executeRawUnsafe` (regla ESLint), solo `$queryRaw` con *tagged template* o TypedSQL; TLS a la BD; secretos en el gestor del proveedor (nunca en el repo ni en la imagen).

### API9 · Gestión inadecuada del inventario
- **SEC-64** `openapi.yaml` es el inventario: CI falla si existe una ruta no documentada. Entornos con dominios distintos; staging no contiene datos reales sin anonimizar.
- **SEC-65** Versiones antiguas con fecha de retirada; `X-Min-App-Version` para forzar actualización.

### API10 · Consumo inseguro de APIs
- **SEC-66** Webhooks de Stripe: verificación de firma, tolerancia de 5 min, idempotencia por `event.id`, y re-consulta del objeto a Stripe antes de cambiar estado crítico.
- **SEC-67** Tokens de Apple/Google verificados contra su JWKS (cacheado con TTL); respuestas de terceros validadas con zod; timeouts y *circuit breaker*.

## C · Transversal backend

- **SEC-70** Cifrado en reposo del disco (proveedor) + cifrado a nivel de campo (AES-256-GCM, clave en KMS, *envelope encryption*) para `health_records.data_enc` y `mfa_factors.secret_enc`.
- **SEC-71** `audit_log` para: login, cambios de rol, acceso a salud, exportes, borrados, acceso de soporte, cambios de pagos.
- **SEC-72** Logs con pino + redacción (`redact`) de `authorization`, `password`, `token`, `email`, `phone`, `health`.
- **SEC-73** Dependencias: `pnpm audit`, `osv-scanner`, Renovate, CodeQL / Semgrep en CI.
- **SEC-74** Copias de seguridad cifradas, PITR, prueba de restauración trimestral.
- **SEC-75** Pentest externo (OWASP MASTG + API) antes del lanzamiento público.

## D · RGPD y legal

| Tema | Control |
|---|---|
| Roles | El **centro** es responsable del tratamiento de sus clientes; **Yoclick** es encargado (contrato art. 28 aceptado en el alta). Yoclick es responsable solo de los datos de la cuenta del centro. |
| Datos de salud (art. 9) | Consentimiento explícito separado; módulo opcional por centro; cifrado de campo; acceso por permiso y auditado. |
| Menores | < 14 años: consentimiento del tutor (LOPDGDD art. 7), la cuenta la gestiona el tutor. |
| Derechos | Acceso y portabilidad (exportar JSON), rectificación (editar perfil), supresión (eliminar cuenta), oposición (marketing desmarcado). |
| Ubicación | Datos y copias en la UE; subencargados listados (Stripe, proveedor cloud, correo, Expo push) con cláusulas tipo cuando aplique. |
| Brechas | Procedimiento de notificación en 72 h; contacto de seguridad `security@` y `/.well-known/security.txt`. |
| Tiendas | Apple: eliminación de cuenta en app (5.1.1(v)), Sign in with Apple (4.8), apps Premium desde la cuenta del centro (4.2.6). Google: Data Safety y política de eliminación de cuenta (también vía web). |
| Facturación | Recibos con IVA desglosado; VeriFactu planificado para F2 (obligatorio 2027). |

## E · Pruebas de seguridad obligatorias (CI)

| Repo | Prueba |
|---|---|
| api | Test de aislamiento multi-tenant por endpoint (`tenancy.e2e.spec.ts`) |
| api | Test BOLA cliente-cliente por endpoint con ids |
| api | Test «toda ruta tiene guard de autorización» |
| api | Test de BOPLA: enviar campos prohibidos → ignorados o `400` |
| api | Rate limit de login y join/code |
| api | Webhook con firma inválida → `400`, evento repetido → sin efecto |
| app | Test que falla si se importa `AsyncStorage` fuera de `src/shared/storage/public-cache.ts` |
| app | Lint: prohibido `console.log`, `dangerouslySetInnerHTML`, `eval`, `new Function` |
| ambos | gitleaks, audit de dependencias, SBOM |
