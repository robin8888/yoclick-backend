import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type ContactList } from '../application/ports/chat.repository';
import { isMinor, MAX_CONTACTS } from '../domain/chat-rules';
import { PERSON_SELECT, toContact, type StoredPerson } from './chat-views';

function adultsOnly(people: readonly StoredPerson[], now: Date): StoredPerson[] {
  return people.filter(({ role, user }) => role !== 'client' || !isMinor(user.birthDate, now));
}

/** La administración habla en nombre del centro con cualquier alumno o profesor activo. */
async function listAllPeopleOfCenter(
  client: TenantTransactionClient,
  actor: ActorContext,
): Promise<StoredPerson[]> {
  return client.membership.findMany({
    where: { status: 'active', role: { in: ['client', 'staff'] }, id: { not: actor.membershipId } },
    select: PERSON_SELECT,
    orderBy: { user: { fullName: 'asc' } },
    take: MAX_CONTACTS,
  });
}

/** Los profesores del centro: el alumno puede escribir a cualquiera. */
async function listTeachers(client: TenantTransactionClient): Promise<StoredPerson[]> {
  return client.membership.findMany({
    where: {
      status: 'active',
      role: 'staff',
    },
    select: PERSON_SELECT,
    orderBy: { user: { fullName: 'asc' } },
    take: MAX_CONTACTS,
  });
}

/** Los alumnos del centro: el profesor puede escribir a cualquiera. */
async function listClients(client: TenantTransactionClient): Promise<StoredPerson[]> {
  return client.membership.findMany({
    where: {
      status: 'active',
      role: 'client',
    },
    select: PERSON_SELECT,
    orderBy: { user: { fullName: 'asc' } },
    take: MAX_CONTACTS,
  });
}

async function findActorBirthDate(
  client: TenantTransactionClient,
  actor: ActorContext,
): Promise<Date | null> {
  const member = await client.membership.findUnique({
    where: { id: actor.membershipId },
    select: { user: { select: { birthDate: true } } },
  });
  return member?.user.birthDate ?? null;
}

/** A quién puede escribir quien pregunta; un alumno menor, a nadie hasta que haya tutores. */
export async function listContactsInTransaction(
  client: TenantTransactionClient,
  input: { actor: ActorContext; now: Date },
): Promise<ContactList> {
  const { actor, now } = input;
  if (actor.role === 'owner' || actor.role === 'admin') {
    const people = adultsOnly(await listAllPeopleOfCenter(client, actor), now);
    return { canWriteToCenter: false, people: people.map(toContact) };
  }
  if (actor.role === 'client') {
    const isActorMinor = isMinor(await findActorBirthDate(client, actor), now);
    if (isActorMinor) return { canWriteToCenter: false, people: [] };
    const teachers = await listTeachers(client);
    return { canWriteToCenter: true, people: teachers.map(toContact) };
  }
  const clients = adultsOnly(await listClients(client), now);
  return { canWriteToCenter: true, people: clients.map(toContact) };
}
