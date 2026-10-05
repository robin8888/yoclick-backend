import { toLocalDate } from '../../../shared/time/zoned-time';
import {
  calculateAvailableSlots,
  isStartWithinBookingWindow,
  type CalculatedSlot,
  type SlotCalculationInput,
} from './available-slots';

export interface BookableSlotRequest {
  /** Datos del centro y del servicio; el rango de fechas se deduce de `startsAt`. */
  readonly scheduling: Omit<SlotCalculationInput, 'fromDate' | 'toDate'>;
  readonly startsAt: Date;
  readonly preferredStaffMembershipId: string | null;
}

export type BookableSlotDecision =
  | { readonly kind: 'bookable'; readonly slot: CalculatedSlot }
  | { readonly kind: 'outside_window' }
  | { readonly kind: 'slot_unavailable' };

/**
 * Decide si una hora de inicio que envía la app es reservable. Se recalcula siempre en el servidor:
 * la hora debe coincidir EXACTAMENTE con un hueco de la rejilla, porque nunca se confía en el cliente.
 * Si se pide a una persona concreta, solo cuenta si está libre ella.
 */
export function findBookableSlot(request: BookableSlotRequest): BookableSlotDecision {
  const { scheduling, startsAt, preferredStaffMembershipId } = request;
  if (!isStartWithinBookingWindow(startsAt, scheduling)) return { kind: 'outside_window' };

  const date = toLocalDate(startsAt, scheduling.timeZone);
  const [day] = calculateAvailableSlots({ ...scheduling, fromDate: date, toDate: date });
  const matchingSlot = day?.slots.find((slot) => slot.startsAt.getTime() === startsAt.getTime());
  if (!matchingSlot) return { kind: 'slot_unavailable' };

  if (preferredStaffMembershipId === null) return { kind: 'bookable', slot: matchingSlot };
  const preferredStaff = matchingSlot.freeStaff.filter(
    (member) => member.membershipId === preferredStaffMembershipId,
  );
  return preferredStaff.length === 0
    ? { kind: 'slot_unavailable' }
    : { kind: 'bookable', slot: { ...matchingSlot, freeStaff: preferredStaff } };
}
