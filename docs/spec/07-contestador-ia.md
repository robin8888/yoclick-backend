# 07 · Contestador IA de citas (add-on)

Un agente de voz atiende las llamadas que el centro desvía a un **número puente** que Yoclick le asigna. Consulta
huecos, reserva, cancela y cambia citas en la agenda real del centro, apunta a la lista de espera y pasa la llamada
a una persona. **Fase 2**: modelo de datos, módulo `src/modules/voice-receptionist`, webhooks del agente y
endpoints del panel. **Fase 3**: facturación del add-on y medición de minutos (ver [Facturación y minutos](#facturación-y-minutos)).
Las pantallas son la fase 4; la guía de Vapi, la fase 5.

## Reglas que no se rompen

1. **Todo detrás de `centers.is_voice_receptionist_enabled`** (por defecto `false`). Apagado, Yoclick funciona
   exactamente igual y los webhooks contestan «no disponible» (`shouldTransfer: true`).
2. **No se toca la lógica de reservas.** El bot llama a los mismos casos de uso que la app (`CreateBookingUseCase`,
   `JoinGroupSessionUseCase`, `CancelBookingUseCase`, `RescheduleBookingUseCase`, `GetAvailabilityUseCase`,
   `ListServiceSessionsUseCase`, `JoinWaitlistUseCase`) con quien llama como `ActorContext` de rol `client`. Aforo,
   bonos, horarios y antelación son los de siempre. La única excepción está en [Cita de prueba](#cita-de-prueba).
3. **El centro lo decide siempre el número puente al que se llamó** (`voice_phone_lines.phone_number`), nunca un dato
   que mande el modelo de lenguaje. La persona tampoco: queda ligada a la **llamada** (`voice_call_logs.caller_membership_id`,
   por el id de llamada que pone el proveedor). Los argumentos de las herramientas son `z.strictObject`: un
   `centerId` o `membershipId` inventado se rechaza.
4. **Solo cambios aditivos**: migraciones `20261204090000_voice_receptionist` y `20261205090000_voice_addon_billing`
   (tablas nuevas y columnas opcionales o con valor por defecto).

## Quién llama

- Un centro **con bonos** (módulo `passes` no apagado) habla de _alumnos_; el resto, de _clientes_.
- Se identifica con el **código de 6 cifras** de su perfil (`memberships.student_code`, único por centro). Se sortea la
  primera vez que la persona lo pide: `GET /v1/centers/:centerId/me/student-code` (rol `client`). El teléfono que
  llama solo es una pista (`phoneMatchesCaller`).
- **3 códigos erróneos** desde un mismo número → el bot pasa a una persona y ese número queda bloqueado 30 minutos
  (`voice_code_attempts`).
- **Tope por centro**: contra quien prueba códigos llamando desde muchos números, cada centro admite
  `VOICE_CENTER_CODE_FAILURES_PER_HOUR` códigos erróneos por hora (20 por defecto, `voice_code_failure_windows`,
  hora natural UTC). Alcanzado, el bot ya no prueba ningún código (ni el bueno) y pasa a una persona; los códigos
  acertados no cuentan.
- El bot **solo dice el nombre de pila** y solo cancela o cambia citas de la persona identificada en esa llamada.
- Quien no es alumno ni cliente queda como **invitado**: `User` con correo `…@voice-guest.yoclick.invalid` (nadie lo
  recibe ni puede registrarse con él), contraseña inutilizable y su teléfono, más una `Membership` de rol `client`
  con `join_source = 'voice_guest'` e `is_student = false` (así no cuenta para el tope de clientes del plan). Si
  vuelve a llamar, se le reconoce por el número.

## Cita de prueba

Un invitado en un centro con bonos no tiene bono, así que la regla de siempre rechazaría su reserva. La única
excepción: `services.allows_trial_bookings = true` y **solo para invitados del contestador**. Está en
`passes/infrastructure/pass-availability.ts` (`checkOwnPass`): si la membresía es `voice_guest` y el servicio admite
citas de prueba, devuelve `ok`. Cualquier otra persona o servicio sigue las reglas de siempre (hay tests de que un
alumno no la recibe). En un centro sin bonos, el invitado reserva cualquier servicio.
El bot nunca ofrece a un invitado un servicio que no sea de prueba (en centros con bonos) y, si lo pide, pasa la
llamada a una persona.

## Capacidades según el plan

No hay tabla propia: `domain/voice-capabilities.ts` pregunta a `shared/centers/plan-features.ts`, así que cambiar de
plan cambia al bot solo.

| Capacidad                                                               | Plan                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| Consultar, reservar, cancelar, cambiar, horarios, pasar a una persona   | todos                                                 |
| Lista de espera (`waitlist`), clases en grupo (`groups` + `rooms`)      | Pro, Premium                                          |
| Reservar para un hijo (`families`)                                      | Pro, Premium — **detectado pero aún sin herramienta** |
| Saludo, nombre y voz propios (`customAppearance`)                       | Premium (402 `PLAN_FEATURE_NOT_INCLUDED` si no)       |
| Enlace de pago por **email** (`onlinePayments`); nunca se cobra por voz | Premium — **sin construir (fase 3+)**                 |

## Webhooks del agente (públicos, `@Public`)

Todos `POST /v1/webhooks/voice/…`, con el secreto compartido del proveedor en la cabecera (con Vapi,
`Authorization: Bearer <secreto>` o, con una credencial «legacy», `X-Vapi-Secret`). Contestan **200** con el resultado para el bot (un rechazo de negocio no es un error HTTP); secreto erróneo,
401; cuerpo mal formado, 400. Límite `RATE_LIMITS.voiceWebhook` por IP. Los logs de la API no llevan cuerpos ni
cabeceras (solo id, método y ruta) y redactan `phone` y `email`.

| Ruta                   | Herramienta                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `available-sessions`   | `getAvailableSessions` (sin servicio: lista de servicios; con él: horas libres o clases con plaza)                              |
| `identify-caller`      | `identifyCaller`                                                                                                                |
| `caller-bookings`      | `getCallerBookings`                                                                                                             |
| `bookings`             | `createBookingForCaller` (idempotente)                                                                                          |
| `bookings/cancel`      | `cancelBookingForCaller`                                                                                                        |
| `bookings/reschedule`  | `rescheduleBookingForCaller`                                                                                                    |
| `waitlist`             | `addCallerToWaitlist` (Pro y Premium)                                                                                           |
| `transfer`             | `transferCallToHuman`                                                                                                           |
| `end-of-call`          | informe de fin de llamada: duración, resumen, transcripción y minutos                                                           |
| `transfer-destination` | a quién pasar la llamada (herramienta nativa `transferCall` de Vapi sin destino fijo); responde `{ destination }` o `{ error }` |
| `events`               | URL única del servidor del asistente: reparte por tipo entre `end-of-call` y `transfer-destination`; el resto, 200 vacío        |

**Idempotencia.** Cada orden se guarda en `voice_tool_calls` por (id de llamada, id de orden): si el proveedor
reintenta, recibe la misma respuesta y no se repite el efecto. Además la reserva lleva una clave derivada de ambos ids
(`Booking.idempotencyKey` es único por cliente).

**Proveedor.** Todo pasa por el puerto `VoiceAgentProvider` (`application/ports`). Adaptadores: `vapi` (formato de los
«server messages» de Vapi; hay que confirmarlo contra una llamada real) y `fake` (desarrollo y tests). Cambiar de
proveedor es escribir otro adaptador.
Variables: `VOICE_PROVIDER` (`fake`|`vapi`), `VOICE_WEBHOOK_SECRET` (obligatoria con `vapi`),
`VOICE_TRANSCRIPT_SWEEP_INTERVAL_SECONDS` y `VOICE_OVERAGE_REPORT_INTERVAL_SECONDS` (0 las apaga),
`VOICE_CENTER_CODE_FAILURES_PER_HOUR`.

## Panel del centro (`owner`, `admin`)

| Ruta                                                       |                                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/centers/:centerId/voice-receptionist`             | estado, número puente, ajustes, capacidades, precio del add-on y consumo                                                                |
| `PUT …/voice-receptionist/config`                          | ajustes (el teléfono de transferencia nunca puede ser el del centro ni el número puente → 422 `VOICE_TRANSFER_PHONE_INVALID`)           |
| `POST …/enable` · `POST …/disable`                         | interruptor (402 `VOICE_ADDON_NOT_CONTRACTED` sin suscripción; 409 `VOICE_LINE_NOT_ASSIGNED` sin número)                                |
| `GET …/calls`                                              | historial paginado con resultado, sin transcripción                                                                                     |
| `GET …/usage`                                              | minutos usados frente a los incluidos                                                                                                   |
| `PUT /v1/platform/centers/:centerId/voice-receptionist`    | alta desde la plataforma: número puente y suscripción; con `shouldBillWithStripe` añade el add-on a la suscripción de Stripe del centro |
| `DELETE /v1/platform/centers/:centerId/voice-receptionist` | baja desde la plataforma: quita las líneas de Stripe, cancela el add-on y apaga el contestador                                          |

Precios y minutos del add-on no están en el código: `voice_addon_plans` (sembrada con 49/69/89 €, 150/250/400
minutos y 0,35 €/min de exceso). Los minutos se cuentan en minutos enteros empezados (`voice_usage_periods`).
Los ajustes (`GET`/`PUT config`) incluyen `overagePolicy`: `continue_and_charge` (por defecto) o `disable_bot`.

## Facturación y minutos

El add-on se cobra como **líneas adicionales de la suscripción de Stripe que el centro ya tiene** (la que cobra su
plan, Stripe Billing). No es Stripe Connect (eso es para que los centros cobren a sus alumnos) ni abre una segunda
suscripción: así hay una sola factura, un solo ciclo de cobro y el IVA es el mismo que el del plan. Todo va por el
puerto `BillingGateway` (adaptadores `stripe` y `fake`).

### Qué crea `npm run billing:setup`

Además de lo de los planes, deja en Stripe (idempotente: se reconoce todo por id o por `lookup_key`):

| Objeto                                         | Identificación                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Producto del add-on                            | id `yoclick_voice_addon` (no empieza por `yoclick_plan_`: el cobro del plan nunca lo confunde con un plan) |
| Medidor de minutos (Billing Meter)             | `event_name = yoclick_voice_minutes`, agregación suma, cliente por `stripe_customer_id`, valor en `value`  |
| Precio fijo mensual por escalón                | `lookup_key = yoclick_voice_<plan>_monthly_<céntimos>`, `tax_behavior = exclusive`                         |
| Precio medido del minuto de exceso por escalón | `lookup_key = yoclick_voice_<plan>_overage_<céntimos>`, `usage_type = metered`, ligado al medidor          |

Los importes salen de `voice_addon_plans`; los ids de Stripe se guardan en `stripe_monthly_price_id` y
`stripe_overage_price_id` de esa misma tabla. Un precio de Stripe no se puede cambiar: si cambias un importe en la
tabla y repites `billing:setup`, nace un precio nuevo (otra `lookup_key`) y no se toca el viejo. El IVA es la tasa
del 21 % que ya usan los planes (`platform_plans.stripe_tax_rate_id`).

### Contratar, cambiar de plan y dar de baja

- **Alta** (plataforma): `PUT /v1/platform/centers/:centerId/voice-receptionist` con `shouldBillWithStripe: true`.
  Exige que el centro tenga suscripción de Stripe y que `billing:setup` ya haya creado los precios del add-on
  (si no, 409 `VOICE_ADDON_BILLING_NOT_READY`). Añade las dos líneas a su suscripción (prorrateo de Stripe por
  defecto), guarda sus ids (`voice_receptionist_subscriptions.stripe_subscription_item_id` y
  `stripe_overage_item_id`) y toma el **periodo de cobro** de la suscripción. Repetir el alta reutiliza las líneas
  que ya estén puestas. Sin `shouldBillWithStripe` (valor por defecto) es un centro piloto: no se toca Stripe ni se
  factura nada, y por tanto tampoco se comunica exceso.
- **Contratar desde la página de pago del plan** (el propietario, fuera de la app): la página de Stripe del enlace
  firmado del correo ofrece el add-on como **línea opcional** (`optional_items`, API `2025-03-31.basil`, fijada
  solo en esa llamada): quien paga elige con o sin él y Stripe muestra el total. Solo con pago **mensual** y si
  `billing:setup` ya creó los precios del escalón de ese plan; con pago anual no se ofrece. Stripe no deja que la
  línea de exceso medido sea opcional ni que se mezcle con ella, así que se completa después: al llegar
  `checkout.session.completed`, si la suscripción nueva trae la línea fija del add-on
  (`BillingGateway.hasVoiceAddonLine`), se añade la línea de exceso (`attachVoiceAddon` reutiliza la fija) y se da
  de alta el add-on del centro con los minutos de su plan (`activateVoiceAddonChosenAtCheckout`, un `upsert`:
  repetir el aviso no duplica nada). El IVA de la línea opcional sale de `subscription_data[default_tax_rates]`.
  El **número puente** lo asigna después la plataforma (`PUT …/voice-receptionist`): hasta entonces el bot sigue
  apagado. El correo del enlace lo menciona sin precios. Sigue sin haber botón ni precios en la app (Apple 3.1.1).
- **Alta por la plataforma**, para centros que ya pagan su plan (no pueden volver a una página de pago, y Checkout
  ni el portal añaden líneas a una suscripción existente): la vía de arriba.
- **Cambio de plan**: al llegar el aviso `customer.subscription.updated` con otro plan, los **minutos incluidos**
  pasan a los del escalón nuevo y las dos líneas cambian al precio de ese escalón en Stripe. El cambio en Stripe
  va dentro de la transacción del aviso: si falla, el aviso no queda atendido y Stripe lo reintenta. Las
  capacidades del bot se derivan del plan, así que cambian solas.
- **Estado**: el add-on sigue a la suscripción. Cobro fallido o suscripción detenida → `paused` (el bot no atiende;
  si el pago se arregla, vuelve solo). Suscripción cancelada o líneas del add-on fuera de la suscripción →
  `cancelled` y se apaga `is_voice_receptionist_enabled`. Un add-on cancelado no resucita por un aviso que no diga
  nada de sus líneas.
- **Baja** (plataforma): `DELETE /v1/platform/centers/:centerId/voice-receptionist` quita las líneas de la
  suscripción (con `clear_usage` en la medida) y cancela el add-on.

### Periodo y minutos

El periodo de los minutos es el **ciclo de cobro de la suscripción**, no el mes natural: se actualiza con cada
`customer.subscription.updated` (periodo en la suscripción o, en las versiones nuevas de la API, en cada línea). Si
Stripe aún no avisó de la renovación, se avanza mes a mes desde el último periodo conocido con el mismo día de
cobro. El periodo nuevo empieza a cero (`voice_usage_periods` tiene una fila por periodo).

### Exceso de minutos (medido)

- Cada llamada guarda `billed_minutes` y `overage_minutes`: la parte de sus minutos que pasa de los incluidos en el
  periodo. La suma de los excesos de un periodo es exactamente `usados − incluidos`.
- Al terminar la llamada se comunica ese exceso al medidor (`POST /v1/billing/meter_events`) con
  `identifier = yoclick-voice-overage-<id de la llamada>` y el instante en que acabó. **Nunca se cuenta dos veces**:
  Stripe descarta un `identifier` repetido (ventana de al menos 24 horas) y la llamada queda marcada con
  `overage_reported_at`.
- Si Stripe falla, la llamada queda pendiente (`overage_reported_at` nulo) y la reintenta `VoiceOverageReportSweeper`
  (cada `VOICE_OVERAGE_REPORT_INTERVAL_SECONDS`, 300 por defecto, 0 lo apaga) con el mismo identificador. Solo se
  reintenta lo de los últimos 34 días (Stripe no admite eventos más viejos de 35). Un fallo nunca impide atender el
  aviso de fin de llamada: los minutos ya están guardados.
- Solo se comunica lo de centros con cliente de Stripe y línea de uso medido (los pilotos no generan nada).

### Avisos del 80 % y el 100 %

Al cruzar cada umbral, **una vez por periodo** (`voice_usage_periods.alerted_80_at` / `alerted_100_at`, que se
apuntan antes de enviar, así dos llamadas simultáneas no avisan dos veces):

- aviso dentro de la app + push a propietarios y administración (`voice_minutes_80`, `voice_minutes_100`), con un
  texto genérico y sin importes ni llamadas a contratar (Apple 3.1.1);
- correo al propietario con los minutos usados, qué pasará según la opción del centro y, si sigue el cobro del
  exceso, el precio por minuto (sin IVA). Sin enlaces: la opción se cambia en los ajustes de la app.

### Qué hace el bot al agotar los minutos

Opción por centro, `voice_agent_configs.overage_policy`:

- `continue_and_charge` (por defecto): sigue atendiendo y el exceso se mide y se factura.
- `disable_bot`: al llegar a los minutos incluidos el bot deja de atender (las herramientas contestan
  `included_minutes_exhausted` con `shouldTransfer`, y la llamada sigue su camino normal) hasta que empiece el
  periodo siguiente o el propietario cambie la opción.

### Cómo probarlo con claves de prueba de Stripe

1. En el back: `npm run db:deploy` (aplica `20261205090000_voice_addon_billing`) y, con `PAYMENT_PROVIDER=stripe` y la
   clave de prueba, `npm run billing:setup`. Comprueba en el panel de Stripe (modo prueba) el producto
   `yoclick_voice_addon`, el medidor «Minutos del Contestador IA» y los precios `yoclick_voice_*`.
2. Abre el enlace de pago mensual del correo: la página de Stripe debe ofrecer el Contestador IA como línea
   opcional y mostrar el total. Págala con y sin él (tarjeta de prueba 4242…); con él, la suscripción trae tres
   líneas (plan, cuota del add-on y minutos de exceso) y el centro tiene su alta del add-on. Para un centro que ya
   paga su plan, como administración de la plataforma, `PUT /v1/platform/centers/:id/voice-receptionist` con `shouldBillWithStripe: true`. En Stripe, la
   suscripción del cliente tiene ahora dos líneas más.
3. Llamadas de prueba (o `POST /v1/webhooks/voice/end-of-call` con el secreto) hasta pasar de los minutos incluidos:
   el medidor del cliente en Stripe suma el exceso y la factura de la próxima renovación lo trae (en modo prueba se
   puede avanzar el reloj de la suscripción con un _test clock_).
4. Cambia el plan del centro desde el portal de Stripe: las dos líneas pasan al escalón nuevo y
   `included_minutes` cambia.
5. Los avisos del 80 % y el 100 % llegan como aviso en la app y correo (con `EMAIL_PROVIDER=console` se ven en la
   consola de la API).

Stripe recomienda hoy Metronome para integraciones nuevas de cobro por uso y mantiene los Billing Meters para las
ya existentes; si el cobro del exceso creciera en complejidad, el puerto `BillingGateway` permite cambiarlo.

## RGPD

- **Aviso** al inicio de la llamada («es un asistente virtual y la llamada se transcribe para gestionar la cita»):
  texto configurable (`voice_agent_configs.legal_notice`); lo pronuncia el asistente (prompt de la fase 5).
- **Retención de transcripciones** configurable por centro (1–365 días, 30 por defecto): `VoiceTranscriptSweeper`
  vacía la transcripción vencida; duración, resumen y resultado se conservan.
- **Subencargados del tratamiento** (para actualizar el contrato de encargado del tratamiento / DPA):

  | Función                        | Proveedor previsto          |
  | ------------------------------ | --------------------------- |
  | Orquestación del agente de voz | Vapi                        |
  | Telefonía y número puente      | Twilio (o Telnyx / SIP)     |
  | Voz a texto (STT)              | el que se configure en Vapi |
  | Modelo de lenguaje (LLM)       | el que se configure en Vapi |
  | Texto a voz (TTS)              | el que se configure en Vapi |

  Confirmar región de tratamiento y transferencias internacionales de cada uno antes de producción.

## Abierto

- Reservar para un hijo por voz (capacidad detectada, herramienta pendiente).
- Enlace de pago por email para el alumno (Premium, `canSendPaymentLink`): sin construir.
- **No verificado contra Stripe real**: que `optional_items` acepte el precio fijo del add-on junto a un plan
  mensual y una cuota de alta única, que el IVA por defecto de la suscripción se vea en esa línea de la página de
  pago, y que la línea elegida llegue a la suscripción creada (se lee con `hasVoiceAddonLine`). Si algo de esto
  falla en la prueba, la alternativa es un segundo enlace «plan + Contestador IA» (dos sesiones de pago).
- La prueba gratuita: el primer cobro (y con él el del add-on) se aplaza igual que el del plan.
- Un centro con plan **anual** tiene una suscripción anual y las líneas del add-on son mensuales. Stripe solo admite
  mezclar intervalos en una suscripción con el modo de facturación flexible (`billing_mode=flexible`), que las
  suscripciones de los planes no usan hoy. Por eso el alta con cobro de un centro de plan anual se rechaza (409
  `VOICE_ADDON_ANNUAL_PLAN_NOT_SUPPORTED`) en lugar de fallar a medias en Stripe. Hay que
  decidir si el add-on solo se ofrece a centros con plan mensual o si se pasan las suscripciones al modo flexible.
  **No verificado contra Stripe real.**
- Reclamar la cuenta de invitado cuando la persona se registre con la app (hoy el invitado no se enlaza).
- El código de alumno se crea al pedirlo (la app debe llamarlo al abrir el inicio), no al registrarse.
- El formato de los mensajes de Vapi se contrastó con su documentación el 28-10-2026 (ver
  [`docs/guides/contestador-ia-vapi.md`](../guides/contestador-ia-vapi.md)); falta confirmarlo con una llamada real
  (número llamado en `call.phoneNumber.number`, fechas de inicio y fin en el informe de fin, varias órdenes en un
  mismo aviso).
