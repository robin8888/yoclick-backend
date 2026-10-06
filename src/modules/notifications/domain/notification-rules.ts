export const NOTIFICATION_KINDS = ['booking_created', 'booking_cancelled'] as const;
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
