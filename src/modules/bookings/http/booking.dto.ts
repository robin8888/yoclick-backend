import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

const MIN_PAGE_SIZE = 1;
const MAX_MY_BOOKINGS_PAGE_SIZE = 50;
const DEFAULT_MY_BOOKINGS_PAGE_SIZE = 20;

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class BookingRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), bookingId: z.uuid() }),
) {}

export class CreateBookingRequestDto extends createZodDto(
  z.strictObject({
    serviceId: z.uuid(),
    /** UTC con `Z`. Debe coincidir exactamente con un hueco de `GET /availability`. */
    startsAt: z.iso.datetime(),
    staffMembershipId: z.uuid().optional(),
  }),
) {}

export class RescheduleBookingRequestDto extends createZodDto(
  z.strictObject({
    /** UTC con `Z`. Debe coincidir exactamente con un hueco de `GET /availability` del mismo servicio. */
    startsAt: z.iso.datetime(),
  }),
) {}

/** El equipo mueve la cita de un cliente a otra hora desde la agenda. */
export class RescheduleAgendaBookingRequestDto extends createZodDto(
  z.strictObject({
    /** UTC con `Z`. Debe coincidir con un hueco del mismo servicio (rejilla de 15 minutos). */
    startsAt: z.iso.datetime(),
    /** La profesional de la hora nueva; sin ella, la misma de la cita. El personal solo la suya. */
    staffMembershipId: z.uuid().optional(),
  }),
) {}

/** Una cita que el equipo crea para un cliente desde la agenda. */
export class CreateAgendaBookingRequestDto extends createZodDto(
  z.strictObject({
    clientMembershipId: z.uuid(),
    serviceId: z.uuid(),
    /** UTC con `Z`. Debe coincidir exactamente con un hueco de `GET /availability`. */
    startsAt: z.iso.datetime(),
    /** La profesional que la da; quien es profesional solo puede ponerla en su propia agenda. */
    staffMembershipId: z.uuid().optional(),
    /** Privada (una persona, por defecto) o grupal (tantas como el aforo de la sala). */
    mode: z.enum(['private', 'group']).default('private'),
    /** Sala donde se da; sin ella se usa una libre de la profesional. La grupal necesita sala. */
    roomId: z.uuid().optional(),
  }),
) {}

/** Apuntar a un cliente a una clase grupal que ya existe. */
export class JoinGroupSessionRequestDto extends createZodDto(
  z.strictObject({ clientMembershipId: z.uuid(), classSessionId: z.uuid() }),
) {}

export class PlacementOptionsQueryDto extends createZodDto(
  z.strictObject({
    date: z.iso.date(),
    serviceId: z.uuid(),
    staffMembershipId: z.uuid(),
  }),
) {}

const placementRoomShape = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  capacity: z.number().int(),
});

const roomSessionShape = z.strictObject({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  mode: z.enum(['private', 'group']),
  capacity: z.number().int(),
  /** Plazas ocupadas por reservas no canceladas. */
  bookedCount: z.number().int(),
  service: z.strictObject({ id: z.uuid(), name: z.string(), color: z.string().nullable() }),
  teacher: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }),
  /** Horario del que nació la sesión; `null` si se creó al dar una cita. */
  schedule: z.strictObject({ seriesId: z.uuid(), label: z.string().nullable() }).nullable(),
  /** Cancelada por el centro ese día y por qué (festivo, ausencia, bloqueo…); `null` si sigue en pie. */
  cancelledReason: z.string().nullable(),
  attendees: z.array(
    z.strictObject({
      bookingId: z.uuid(),
      clientMembershipId: z.uuid(),
      fullName: z.string(),
      status: z.enum(['confirmed', 'cancelled', 'attended', 'no_show']),
      /** Plaza de grupo fijo (matrícula) o cita suelta. */
      source: z.enum(['single', 'enrollment']),
    }),
  ),
});

const roomBlockSummaryShape = z.strictObject({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.enum(['rental', 'maintenance', 'event', 'other']),
  note: z.string().nullable(),
});

export class RoomAgendaQueryDto extends createZodDto(z.strictObject({ date: z.iso.date() })) {}

export class RoomAgendaResponseDto extends createZodDto(
  z.strictObject({
    date: z.iso.date(),
    timezone: z.string(),
    /** Cuándo abre el centro ese día, en hora local; vacío si cierra. */
    openingRanges: z.array(z.strictObject({ opensAt: z.string(), closesAt: z.string() })),
    /** Cada sala del centro con lo que la ocupa ese día. */
    rooms: z.array(
      z.strictObject({
        id: z.uuid(),
        name: z.string(),
        capacity: z.number().int(),
        /** Profesor fijo de la sala; `null` si la usa cualquiera. */
        staff: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }).nullable(),
        sessions: z.array(roomSessionShape),
        /** Tramos en que la sala no está disponible ese día (alquiler, mantenimiento, evento). */
        blocks: z.array(roomBlockSummaryShape),
      }),
    ),
    /** Citas de ese día que no tienen sala. */
    sessionsWithoutRoom: z.array(roomSessionShape),
  }),
) {}

export class GroupOptionsQueryDto extends createZodDto(
  z.strictObject({ date: z.iso.date(), serviceId: z.uuid() }),
) {}

export class GroupOptionsResponseDto extends createZodDto(
  z.strictObject({
    timezone: z.string(),
    /** Salas con profesor que dan el servicio, con sus horas libres y sus grupos con plazas. */
    rooms: z.array(
      z.strictObject({
        room: z.strictObject({
          id: z.uuid(),
          name: z.string(),
          capacity: z.number().int(),
          staff: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }),
        }),
        openSlots: z.array(
          z.strictObject({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
        ),
        groupSessions: z.array(
          z.strictObject({
            sessionId: z.uuid(),
            startsAt: z.iso.datetime(),
            endsAt: z.iso.datetime(),
            serviceName: z.string(),
            room: z.strictObject({ id: z.uuid(), name: z.string() }),
            capacity: z.number().int(),
            bookedCount: z.number().int(),
          }),
        ),
      }),
    ),
  }),
) {}

export class PlacementOptionsResponseDto extends createZodDto(
  z.strictObject({
    timezone: z.string(),
    /** Si la profesional tiene salas que usar; sin ellas la cita no lleva sala ni puede ser grupal. */
    hasUsableRooms: z.boolean(),
    /** Horas libres de la profesional con las salas libres que puede usar a esa hora. */
    openSlots: z.array(
      z.strictObject({
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        freeRooms: z.array(placementRoomShape),
      }),
    ),
    /** Clases grupales suyas ese día a las que todavía caben más personas. */
    groupSessions: z.array(
      z.strictObject({
        sessionId: z.uuid(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        serviceName: z.string(),
        room: z.strictObject({ id: z.uuid(), name: z.string() }),
        capacity: z.number().int(),
        bookedCount: z.number().int(),
      }),
    ),
  }),
) {}

export class MyBookingsQueryDto extends createZodDto(
  z.strictObject({
    scope: z.enum(['upcoming', 'past']).default('upcoming'),
    limit: z.coerce
      .number()
      .int()
      .min(MIN_PAGE_SIZE)
      .max(MAX_MY_BOOKINGS_PAGE_SIZE)
      .default(DEFAULT_MY_BOOKINGS_PAGE_SIZE),
  }),
) {}

export class AgendaQueryDto extends createZodDto(
  z.strictObject({ date: z.iso.date(), staffMembershipId: z.uuid().optional() }),
) {}

export const bookingShape = {
  id: z.uuid(),
  status: z.enum(['confirmed', 'cancelled', 'attended', 'no_show']),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  service: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    durationMinutes: z.number().int(),
    color: z.string().nullable(),
  }),
  staff: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }),
  /** Sala donde se da; `null` si la cita no tiene sala. */
  room: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  /** La sesión que ocupa: privada, o grupal con su aforo y las plazas ya ocupadas. */
  session: z.strictObject({
    id: z.uuid(),
    mode: z.enum(['private', 'group']),
    capacity: z.number().int(),
    bookedCount: z.number().int(),
  }),
  cancelledAt: z.iso.datetime().nullable(),
  /** Si se canceló con la antelación de la política; `null` mientras no se cancele. */
  cancelWithinPolicy: z.boolean().nullable(),
  /** Cuándo empezó la clase en el servidor; la app calcula el temporizador a partir de aquí. */
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  /** Fin menos inicio en segundos enteros; `null` mientras no haya terminado. */
  actualDurationSeconds: z.number().int().nullable(),
  /** Cita suelta o plaza de un grupo fijo (matrícula, no gasta bono). */
  source: z.enum(['single', 'enrollment']),
  createdAt: z.iso.datetime(),
  /** Quién asignó la cita y con qué papel; `null` en las anteriores a este dato. */
  createdBy: z
    .strictObject({
      membershipId: z.uuid(),
      fullName: z.string(),
      role: z.enum(['owner', 'admin', 'staff', 'client']),
    })
    .nullable(),
};

export class BookingResponseDto extends createZodDto(z.strictObject(bookingShape)) {}

export class MyBookingsResponseDto extends createZodDto(
  z.strictObject({ bookings: z.array(z.strictObject(bookingShape)) }),
) {}

export class CancelBookingResponseDto extends createZodDto(
  z.strictObject({
    booking: z.strictObject(bookingShape),
    /** Quedaba al menos la antelación que marca la política (o el propio servicio). */
    withinPolicy: z.boolean(),
  }),
) {}

export class AgendaResponseDto extends createZodDto(
  z.strictObject({
    date: z.iso.date(),
    timezone: z.string(),
    /** Cuándo abre el centro ese día, en hora local; vacío si cierra. */
    openingRanges: z.array(z.strictObject({ opensAt: z.string(), closesAt: z.string() })),
    entries: z.array(
      z.strictObject({
        booking: z.strictObject(bookingShape),
        client: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }),
      }),
    ),
  }),
) {}
