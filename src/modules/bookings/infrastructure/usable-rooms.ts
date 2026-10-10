import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';

export interface UsableRoom {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

/**
 * Las salas que puede usar una persona del equipo: las suyas y las que no tienen profesor fijo, las
 * suyas primero; si el servicio tiene sala fija, solo esa. La RLS acota al centro; las archivadas
 * no cuentan.
 */
export async function listUsableRooms(
  client: TenantTransactionClient,
  staffMembershipId: string,
  options: { serviceRoomId?: string | null } = {},
): Promise<UsableRoom[]> {
  const rooms = await client.room.findMany({
    where: {
      archivedAt: null,
      OR: [{ staffMembershipId }, { staffMembershipId: null }],
      // Un servicio con sala fija solo se da en esa sala.
      ...(options.serviceRoomId !== undefined &&
        options.serviceRoomId !== null && { id: options.serviceRoomId }),
    },
    select: { id: true, name: true, capacity: true, staffMembershipId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const isOwnRoom = (room: { staffMembershipId: string | null }): boolean =>
    room.staffMembershipId === staffMembershipId;
  return [...rooms.filter(isOwnRoom), ...rooms.filter((room) => !isOwnRoom(room))].map(
    ({ id, name, capacity }) => ({ id, name, capacity }),
  );
}
