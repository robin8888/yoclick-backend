import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { isModeAllowedByService, type SessionModeName } from '../domain/schedule-rules';

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

export interface SeriesService {
  readonly id: string;
  readonly mode: 'private' | 'group' | 'both';
  readonly capacity: number;
  readonly roomId: string | null;
  /** Alquiler: la clase puede darse sin profesor. */
  readonly isRental: boolean;
}

export interface SeriesRoom {
  readonly id: string;
  readonly capacity: number;
  readonly staffMembershipId: string | null;
  readonly serviceId: string | null;
}

export type SeriesRefusal =
  | 'service_not_found'
  | 'staff_not_found'
  | 'room_not_found'
  | 'staff_required'
  | 'staff_not_for_service'
  | 'mode_not_allowed'
  | 'room_not_for_service';

export type ResolvedSeriesParts =
  | {
      readonly kind: 'resolved';
      readonly service: SeriesService;
      readonly room: SeriesRoom | null;
      /** `null` solo en los alquileres. */
      readonly staffMembershipId: string | null;
    }
  | { readonly kind: SeriesRefusal };

export async function findSeriesService(
  client: TenantTransactionClient,
  serviceId: string,
): Promise<SeriesService | null> {
  return client.service.findFirst({
    where: { id: serviceId, archivedAt: null },
    select: { id: true, mode: true, capacity: true, roomId: true, isRental: true },
  });
}

async function findSeriesRoom(
  client: TenantTransactionClient,
  roomId: string,
): Promise<SeriesRoom | null> {
  return client.room.findFirst({
    where: { id: roomId, archivedAt: null },
    select: { id: true, capacity: true, staffMembershipId: true, serviceId: true },
  });
}

/** La RLS acota al centro: una persona de otro centro simplemente no se encuentra. */
async function isActiveTeamMember(
  client: TenantTransactionClient,
  membershipId: string,
): Promise<boolean> {
  const count = await client.membership.count({
    where: { id: membershipId, status: 'active', role: { in: [...TEAM_ROLES] } },
  });
  return count === 1;
}

/** Si la sala puede dar ese servicio con esa persona: sala con servicio fijo, servicio con sala fija y profesor fijo. */
function isRoomUsable(
  room: SeriesRoom,
  input: { service: SeriesService; staffMembershipId: string | null },
): boolean {
  if (room.serviceId !== null && room.serviceId !== input.service.id) return false;
  if (input.service.roomId !== null && input.service.roomId !== room.id) return false;
  return room.staffMembershipId === null || room.staffMembershipId === input.staffMembershipId;
}

export interface SeriesPartsRequest {
  readonly serviceId: string;
  readonly mode: SessionModeName;
  /** Sala pedida; `null` = sin sala (o la fija del servicio si la tiene). */
  readonly roomId: string | null;
  /** Persona pedida; `null` = la fija de la sala. */
  readonly staffMembershipId: string | null;
}

type RoomResolution =
  | { readonly kind: 'resolved'; readonly room: SeriesRoom | null }
  | { readonly kind: 'room_not_found' };

/** La sala pedida o, si no, la fija del servicio; sin ninguna, la serie no lleva sala. */
async function resolveRoom(
  client: TenantTransactionClient,
  input: { requestedRoomId: string | null; service: SeriesService },
): Promise<RoomResolution> {
  const roomId = input.requestedRoomId ?? input.service.roomId;
  if (roomId === null) return { kind: 'resolved', room: null };
  const room = await findSeriesRoom(client, roomId);
  return room === null ? { kind: 'room_not_found' } : { kind: 'resolved', room };
}

type StaffResolution =
  | { readonly kind: 'resolved'; readonly staffMembershipId: string | null }
  | { readonly kind: 'staff_required' | 'staff_not_found' };

/**
 * Si el servicio tiene profesores asignados, solo ellos pueden darlo: el centro elige entre los
 * que dan ese servicio. Un servicio sin ninguno asignado admite a cualquiera del equipo.
 */
async function teachesService(
  client: TenantTransactionClient,
  input: { serviceId: string; membershipId: string },
): Promise<boolean> {
  const assignedCount = await client.serviceStaff.count({ where: { serviceId: input.serviceId } });
  if (assignedCount === 0) return true;
  const matchCount = await client.serviceStaff.count({
    where: { serviceId: input.serviceId, membershipId: input.membershipId },
  });
  return matchCount === 1;
}

/** La persona pedida o, si no, la fija de la sala; tiene que ser del equipo activo. */
async function resolveStaff(
  client: TenantTransactionClient,
  input: {
    requestedStaffMembershipId: string | null;
    room: SeriesRoom | null;
    isRental: boolean;
  },
): Promise<StaffResolution> {
  const staffMembershipId =
    input.requestedStaffMembershipId ?? input.room?.staffMembershipId ?? null;
  if (staffMembershipId === null) {
    // Un alquiler cede la sala sin profesor.
    return input.isRental
      ? { kind: 'resolved', staffMembershipId: null }
      : { kind: 'staff_required' };
  }
  if (!(await isActiveTeamMember(client, staffMembershipId))) return { kind: 'staff_not_found' };
  return { kind: 'resolved', staffMembershipId };
}

/**
 * Comprueba y resuelve de una vez el servicio, la sala y la persona de una serie: que existan, que
 * el servicio admita el modo, que la sala sirva para ese servicio y esa persona.
 */
export async function resolveSeriesParts(
  client: TenantTransactionClient,
  request: SeriesPartsRequest,
): Promise<ResolvedSeriesParts> {
  const service = await findSeriesService(client, request.serviceId);
  if (!service) return { kind: 'service_not_found' };
  if (!isModeAllowedByService(service.mode, request.mode)) return { kind: 'mode_not_allowed' };

  const roomResolution = await resolveRoom(client, { requestedRoomId: request.roomId, service });
  if (roomResolution.kind !== 'resolved') return roomResolution;
  const { room } = roomResolution;

  const staffResolution = await resolveStaff(client, {
    requestedStaffMembershipId: request.staffMembershipId,
    room,
    isRental: service.isRental,
  });
  if (staffResolution.kind !== 'resolved') return staffResolution;
  const { staffMembershipId } = staffResolution;
  const isTeacherRejected =
    staffMembershipId !== null &&
    !(await teachesService(client, { serviceId: service.id, membershipId: staffMembershipId }));
  if (isTeacherRejected) return { kind: 'staff_not_for_service' };

  if (room !== null && !isRoomUsable(room, { service, staffMembershipId })) {
    return { kind: 'room_not_for_service' };
  }
  return { kind: 'resolved', service, room, staffMembershipId };
}
