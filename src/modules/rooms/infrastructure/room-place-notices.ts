import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type RoomPlace } from '../../../shared/location/session-location';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type EnrollmentNotificationData } from '../../notifications/domain/notification-rules';

interface RoomPlaceChange {
  readonly room: { readonly id: string; readonly name: string };
  readonly before: RoomPlace | null;
  readonly after: RoomPlace | null;
}

/** Cada persona con plaza en una clase futura de la sala (y quien la da), una sola vez. */
async function listPeopleOfFutureClasses(
  client: TenantTransactionClient,
  roomId: string,
): Promise<Set<string>> {
  const sessions = await client.classSession.findMany({
    where: {
      roomId,
      status: 'scheduled',
      startsAt: { gt: new Date() },
      // Las clases con un lugar propio (un cambio de ese día) no dependen del de la sala.
      locationName: null,
    },
    select: {
      staffMembershipId: true,
      bookings: { where: { status: 'confirmed' }, select: { clientMembershipId: true } },
    },
  });
  const people = new Set<string>();
  for (const session of sessions) {
    if (session.staffMembershipId !== null) people.add(session.staffMembershipId);
    for (const booking of session.bookings) people.add(booking.clientMembershipId);
  }
  return people;
}

/**
 * Si el lugar de una sala exterior cambia, avisa a quienes tienen clase en ella: es el mismo aviso
 * que un cambio de horario, con el nombre de la sala y sin profesor.
 */
export async function notifyRoomPlaceChanged(
  client: TenantTransactionClient,
  actor: ActorContext,
  change: RoomPlaceChange,
): Promise<void> {
  if (JSON.stringify(change.before) === JSON.stringify(change.after)) return;
  const recipients = await listPeopleOfFutureClasses(client, change.room.id);
  recipients.delete(actor.membershipId);
  if (recipients.size === 0) return;
  const actorProfile = await client.membership.findUnique({
    where: { id: actor.membershipId },
    select: { user: { select: { fullName: true } } },
  });
  const noticeData: EnrollmentNotificationData = {
    placeName: change.after?.address ?? change.room.name,
    serviceName: '',
    label: change.room.name,
    staffName: '',
    roomName: change.room.name,
    actorName: actorProfile?.user.fullName ?? '',
  };
  await client.notification.createMany({
    data: [...recipients].map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: actor.centerId,
      recipientMembershipId,
      kind: 'schedule_updated' as const,
      data: noticeData,
    })),
  });
}
