export const NOTIFICATION_KINDS = [
  'booking_created',
  'booking_cancelled',
  'booking_created_by_team',
  'booking_cancelled_by_team',
  'absence_added',
  'booking_affected_by_absence',
  'routine_assigned',
  'staff_video_submitted',
  'staff_video_reviewed',
] as const;
export type NotificationKindName = (typeof NOTIFICATION_KINDS)[number];

export const DEFAULT_NOTIFICATION_PAGE_SIZE = 50;
export const MAX_NOTIFICATION_PAGE_SIZE = 100;

/** Los datos de un aviso de reserva: la app compone el texto con el vocabulario del sector. */
// `type` y no `interface`: Prisma guarda el objeto como JSON y pide que sea indexable.
export type BookingNotificationData = {
  readonly clientName: string;
  readonly serviceName: string;
  /** Inicio de la cita (UTC, ISO). */
  readonly startsAt: string;
  readonly staffName: string;
  /** Quien hizo el cambio: la propia persona, el equipo o la administración. */
  readonly actorName: string;
};

/**
 * Quién debe enterarse de una reserva: la persona que da la cita y quienes administran el centro,
 * menos quien acaba de hacerla (no se avisa a alguien de lo que él mismo ha hecho).
 */
export function selectNotificationRecipients(input: {
  readonly staffMembershipId: string;
  readonly administratorMembershipIds: readonly string[];
  readonly actorMembershipId: string;
}): string[] {
  const everyone = new Set([input.staffMembershipId, ...input.administratorMembershipIds]);
  everyone.delete(input.actorMembershipId);
  return [...everyone];
}

export type BookingChange = 'created' | 'cancelled';

export interface BookingNoticePlan {
  readonly recipientMembershipId: string;
  readonly kind: NotificationKindName;
}

/**
 * Quién se entera de un cambio en una cita y con qué aviso:
 * - el equipo (la persona que da la cita y administración) lo ve como una reserva o una cancelación;
 * - el cliente, solo si el cambio lo hizo el equipo: «te han puesto/cancelado una cita».
 * Quien hizo el cambio no recibe aviso de lo que él mismo hizo.
 */
export function planBookingNotices(input: {
  readonly change: BookingChange;
  readonly clientMembershipId: string;
  readonly staffMembershipId: string;
  readonly administratorMembershipIds: readonly string[];
  readonly actorMembershipId: string;
}): BookingNoticePlan[] {
  const teamKind: NotificationKindName =
    input.change === 'created' ? 'booking_created' : 'booking_cancelled';
  const clientKind =
    input.change === 'created' ? 'booking_created_by_team' : 'booking_cancelled_by_team';
  const teamNotices = selectNotificationRecipients(input).map((recipientMembershipId) => ({
    recipientMembershipId,
    kind: teamKind,
  }));
  const isClientTheActor = input.actorMembershipId === input.clientMembershipId;
  return isClientTheActor
    ? teamNotices
    : [{ recipientMembershipId: input.clientMembershipId, kind: clientKind }, ...teamNotices];
}

/** Los datos del aviso de una ausencia del equipo. */
export type AbsenceNotificationData = {
  readonly staffName: string;
  readonly actorName: string;
  /** `YYYY-MM-DD`, ambos extremos incluidos. */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly reason: string;
  /** Citas que ya había en esos días, como texto: los datos del aviso son siempre texto. */
  readonly affectedBookingCount: string;
};

/** Los datos del aviso de una rutina asignada. */
export type RoutineNotificationData = {
  readonly routineName: string;
  readonly actorName: string;
};

/** Los datos del aviso de un vídeo de presentación: quién lo subió y quién hizo el cambio. */
export type VideoNotificationData = {
  readonly uploaderName: string;
  readonly actorName: string;
};
