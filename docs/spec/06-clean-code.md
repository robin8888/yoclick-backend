# 06 · Clean code y nombres descriptivos

Aplica a `yoclick-app` y a `yoclick-api` por igual. Si una regla choca con otra de un `CLAUDE.md`, gana la más estricta.

## 1 · Nombres

**Regla de oro:** quien lea el nombre debe saber qué es o qué hace sin abrir la implementación.

| Tipo | Convención | Bien | Mal |
|---|---|---|---|
| Variables y constantes locales | `camelCase`, sustantivo que describe el contenido | `availableSlots`, `selectedService`, `remainingSessionCount` | `data`, `res`, `arr`, `tmp`, `x`, `s2` |
| Booleanos | prefijo `is`, `has`, `can`, `should` | `isWithinCancellationWindow`, `hasActiveSubscription`, `canManageTeam` | `flag`, `cancel`, `active2` |
| Funciones | verbo + complemento | `calculateAvailableSlots`, `createBooking`, `formatPriceInEuros`, `assertCanAccessBooking` | `handle`, `process`, `doIt`, `calc`, `bookingFn` |
| Funciones que devuelven booleano | igual que booleanos | `isSlotAvailable(slot)` | `checkSlot(slot)` |
| Funciones de conversión | `toX` / `fromX` / `mapXToY` | `mapBookingToResponseDto`, `toCentsFromEuros` | `convert`, `transform` |
| Constantes globales | `UPPER_SNAKE_CASE` con unidad en el nombre | `ACCESS_TOKEN_TTL_SECONDS`, `MAX_UPLOAD_SIZE_BYTES`, `CHECKIN_TOKEN_LIFETIME_SECONDS` | `TTL`, `MAX`, `TIMEOUT` |
| Tipos e interfaces | `PascalCase`, sustantivo; sin prefijo `I` | `BookingStatus`, `CreateBookingInput`, `ActorContext` | `IBooking`, `BookingType2`, `Data` |
| Clases | `PascalCase`, sustantivo; sufijo de rol | `CreateBookingUseCase`, `PrismaBookingRepository`, `StripePaymentGateway` | `BookingManager`, `Helper`, `Utils` |
| Componentes React | `PascalCase`, qué muestra | `NextAppointmentCard`, `SlotPicker`, `CancelBookingSheet` | `Card2`, `MyComponent`, `Wrapper` |
| Hooks | `use` + qué obtiene o hace | `useAvailableSlots`, `useCancelBooking`, `useActiveCenter` | `useData`, `useStuff` |
| Props de eventos | `on` + suceso; handlers internos `handle` + suceso | `onSlotSelect` / `handleSlotSelect` | `click`, `cb`, `fn` |
| Ficheros | igual que lo que exportan | `CreateBookingUseCase.ts` → en back `create-booking.use-case.ts` (convención Nest); en front `SlotPicker.tsx` | `utils.ts`, `helpers.ts`, `index2.ts` |
| Enumeraciones | `PascalCase` el tipo, valores descriptivos | `BookingStatus.Waitlisted` | `Status.W`, `1`, `2` |
| Tests | describen comportamiento | `it('returns SESSION_FULL when the last seat was taken concurrently')` | `it('works')`, `test1` |

Más reglas:

- **Sin abreviaturas** salvo las universales (`id`, `url`, `api`, `dto`, `qr`, `csv`, `iva`). `appointment`, no `appt`; `instructor`, no `instr`; `service`, no `svc`.
- **Unidades en el nombre** cuando el tipo no las lleva: `durationMinutes`, `priceCents`, `timeoutMs`, `distanceKm`.
- **Mismo concepto, misma palabra** en todo el sistema (glosario abajo). No mezclar `client`/`customer`/`user` para lo mismo.
- **Nombres en inglés** en el código; textos visibles en español vía i18n (front) o catálogo de errores (back).
- Longitud proporcional al alcance: un índice de un bucle de 3 líneas puede ser `index`; algo exportado debe ser completo.
- Nada de números mágicos: `if (minutesUntilStart < MINIMUM_CANCELLATION_NOTICE_MINUTES)`, no `if (m < 120)`.

## 2 · Glosario de dominio (nombres canónicos)

| Concepto | En código | Nota |
|---|---|---|
| Centro (gimnasio, academia…) | `Center` | Nunca `Gym` en código compartido |
| Persona con cuenta | `User` | Global, varios centros |
| Pertenencia de un usuario a un centro con un rol | `Membership` | `role: owner \| admin \| staff \| client` |
| Cliente / alumno | `client` (membership con rol client) | La palabra visible sale del vocabulario del sector |
| Instructor / profesor / coach | `staff` (membership con rol staff) | Ídem |
| Servicio reservable | `Service` | `kind: individual \| group` |
| Ocurrencia concreta en el calendario | `ClassSession` | También para citas individuales |
| Reserva | `Booking` | |
| Hueco libre | `AvailableSlot` | Calculado, no se guarda |
| Asistencia | `Attendance` / `checkIn` | |
| Tarifa a la venta (bono, cuota, matrícula) | `Rate` | |
| Tarifa comprada por un cliente | `ClientRate` | |
| Movimiento de saldo | `BalanceMovement` | |
| Tutor de un menor | `guardian` | `Guardianship` |
| Quién hace la petición | `ActorContext` | `{ userId, centerId, membershipId, role, permissions }` |

## 3 · Funciones

- Hacen **una cosa**, a un solo nivel de abstracción. Objetivo ≤ 20 líneas; máximo 40 (ESLint `max-lines-per-function` en warn a 40).
- ≤ 3 parámetros; si hay más, un objeto con nombre (`createBooking({ serviceId, staffMembershipId, startsAt })`).
- Sin parámetros booleanos que cambian el comportamiento (`sendEmail(user, true)`): dos funciones con nombres claros o un objeto de opciones con nombre.
- Retornos tempranos (*guard clauses*) en lugar de `if` anidados; profundidad máxima 3 (`max-depth`).
- Funciones puras siempre que se pueda; los efectos (BD, red, almacenamiento) en los bordes.
- Complejidad ciclomática ≤ 10 (`complexity`).

```ts
// Mal
function chk(b: any, u: any, f: boolean) {
  if (b) { if (b.s !== 'c') { if (f || Date.now() < b.t - 7200000) { return true } } }
  return false
}

// Bien
const MINIMUM_CANCELLATION_NOTICE_MINUTES = 120;

function isWithinCancellationWindow(booking: Booking, now: Date): boolean {
  const minutesUntilStart = differenceInMinutes(booking.startsAt, now);
  return minutesUntilStart >= MINIMUM_CANCELLATION_NOTICE_MINUTES;
}

function canClientCancelBooking(booking: Booking, now: Date): boolean {
  if (booking.status === BookingStatus.Cancelled) return false;
  return isWithinCancellationWindow(booking, now);
}
```

## 4 · Estructura y responsabilidades

- **SOLID** con sentido común: responsabilidad única por clase/módulo, dependencias hacia abstracciones (puertos) en el backend, composición sobre herencia en el front.
- **DRY sin abstracción prematura**: duplicar dos veces está bien; a la tercera se extrae.
- **Sin ficheros cajón de sastre** (`utils.ts`, `helpers.ts`, `common.ts`): cada utilidad en un fichero con nombre de lo que hace (`format-price.ts`, `calculate-available-slots.ts`).
- Comentarios para el **porqué** (decisión, restricción legal, bug externo), nunca para el qué. Si hace falta explicar el qué, renombra.
- Sin código muerto ni comentado; sin `console.log` (usar el logger).
- Errores tipados y con nombre (`SlotUnavailableError`), nunca `throw 'error'` ni `catch {}` vacío.
- Inmutabilidad por defecto (`const`, `readonly`, spreads), mutación solo local y justificada.

## 5 · TypeScript

- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.
- Prohibido `any` (usar `unknown` + validación zod en fronteras); `!` (non-null) solo con comentario del porqué.
- Tipos de retorno explícitos en funciones exportadas.
- Uniones discriminadas para estados (`{ status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'success'; data: Booking[] }`).
- `type` para uniones y composiciones, `interface` para contratos de objetos/props.

## 6 · Herramientas que lo hacen cumplir

| Herramienta | Front | Back |
|---|---|---|
| ESLint (flat config) + `typescript-eslint` `strict-type-checked` | ✓ | ✓ |
| `@typescript-eslint/naming-convention` (booleanos con prefijo, `PascalCase` en tipos, `UPPER_CASE` en constantes globales) | ✓ | ✓ |
| `id-denylist`: `data`, `info`, `tmp`, `temp`, `obj`, `val`, `res`, `arr`, `foo`, `item2`… | ✓ | ✓ |
| `id-length` mínimo 2 (excepción `_`) | ✓ | ✓ |
| `max-lines-per-function` 40, `max-params` 3, `max-depth` 3, `complexity` 10 | ✓ | ✓ |
| `no-magic-numbers` (warn; permitidos 0, 1, -1) | ✓ | ✓ |
| `eslint-plugin-boundaries` (capas Atomic Design / módulos) | ✓ | ✓ |
| `eslint-plugin-sonarjs` (complejidad cognitiva, duplicados) | ✓ | ✓ |
| `eslint-plugin-react`, `react-hooks`, `react-native` | ✓ | — |
| Regla propia: prohibido `$queryRawUnsafe` / `$executeRawUnsafe` y `PrismaClient` fuera de `infrastructure/` | — | ✓ |
| Prettier, Knip (código muerto), `tsc --noEmit` | ✓ | ✓ |

## 7 · Revisión de un PR (checklist)

- [ ] ¿Cada nombre nuevo se entiende sin leer su implementación?
- [ ] ¿Usa los términos del glosario?
- [ ] ¿Funciones cortas, de una sola responsabilidad, sin flags booleanos?
- [ ] ¿Sin números mágicos, sin `any`, sin código comentado?
- [ ] ¿Tests con nombres que describen comportamiento?
- [ ] ¿Respeta los límites de capas?
