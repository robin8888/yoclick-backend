import { type MembershipRoleName } from '../shared/tenancy/actor-context';

/**
 * Contraseña COMPARTIDA de todas las cuentas de demo y de pruebas. Es pública a propósito (está en
 * el repositorio) y por eso el sembrador se niega a ejecutarse en producción.
 */
export const DEMO_PASSWORD = 'Nosnibor88';

/**
 * Yopmail es un buzón público y desechable: cualquiera puede abrir cualquier dirección en yopmail.com
 * sin contraseña. Por eso sirve para ver los correos reales de verificación al probar, y por eso las
 * cuentas de demo no deben tener nada sensible.
 */
export const DEMO_EMAIL_DOMAIN = 'yopmail.com';

/** Prefijo que evita chocar con direcciones de Yopmail que use otra persona (`owner@yopmail.com`). */
export const DEMO_EMAIL_PREFIX = 'yoclick';

export interface DemoCenterDefinition {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly sectorId: string;
  readonly brandColor: string;
  readonly joinCode: string;
}

export interface DemoMembershipDefinition {
  readonly id: string;
  readonly centerId: string;
  readonly role: MembershipRoleName;
}

export interface DemoUserDefinition {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly memberships: readonly DemoMembershipDefinition[];
}

type DemoEntityKind = 'center' | 'user' | 'membership';

const ENTITY_KIND_PREFIX: Readonly<Record<DemoEntityKind, string>> = {
  center: '1',
  user: '2',
  membership: '3',
};
const COUNTER_DIGITS = 11;

/**
 * UUID fijo y válido (versión 7) por entidad: así el seed siempre produce los mismos ids y volver
 * a ejecutarlo actualiza en lugar de duplicar.
 */
function buildDemoId(kind: DemoEntityKind, counter: number): string {
  const paddedCounter = String(counter).padStart(COUNTER_DIGITS, '0');
  return `01930000-0000-7000-8000-${ENTITY_KIND_PREFIX[kind]}${paddedCounter}`;
}

const CENTER_FIELDS = [
  {
    slug: 'studio-norte',
    name: 'Studio Norte',
    sectorId: 'estudio',
    brandColor: '#E4572E',
    joinCode: 'NORTE7',
  },
  {
    slug: 'forja-readaptacion',
    name: 'Forja Readaptación',
    sectorId: 'readap',
    brandColor: '#2446C7',
    joinCode: 'FORJA2',
  },
  {
    slug: 'kine-lab',
    name: 'Kiné Lab',
    sectorId: 'box',
    brandColor: '#C8F031',
    joinCode: 'KINE24',
  },
  {
    slug: 'compas-escuela-de-baile',
    name: 'Compás Escuela de Baile',
    sectorId: 'baile',
    brandColor: '#7A3FE0',
    joinCode: 'COMPAS',
  },
] as const;

export const DEMO_CENTERS: readonly DemoCenterDefinition[] = CENTER_FIELDS.map((fields, index) => ({
  id: buildDemoId('center', index + 1),
  ...fields,
}));

/** Cada centro tiene una persona por rol más dos clientes; así hay con quién probar cada pantalla. */
const ROLE_SEQUENCE: readonly { localPart: string; role: MembershipRoleName; fullName: string }[] =
  [
    { localPart: 'owner', role: 'owner', fullName: 'Marta Ruiz' },
    { localPart: 'admin', role: 'admin', fullName: 'Pablo Soler' },
    { localPart: 'staff', role: 'staff', fullName: 'Álex Moreno' },
    { localPart: 'client1', role: 'client', fullName: 'Lucía Torres' },
    { localPart: 'client2', role: 'client', fullName: 'Daniel Vega' },
  ];

export function buildDemoUsers(centers: readonly DemoCenterDefinition[]): DemoUserDefinition[] {
  let userCounter = 0;
  let membershipCounter = 0;
  const nextMembership = (centerId: string, role: MembershipRoleName): DemoMembershipDefinition => {
    membershipCounter += 1;
    return { id: buildDemoId('membership', membershipCounter), centerId, role };
  };

  const centerUsers = centers.flatMap((center) =>
    ROLE_SEQUENCE.map((person) => {
      userCounter += 1;
      return {
        id: buildDemoId('user', userCounter),
        email: `${DEMO_EMAIL_PREFIX}.${person.localPart}.${center.slug}@${DEMO_EMAIL_DOMAIN}`,
        fullName: person.fullName,
        memberships: [nextMembership(center.id, person.role)],
      };
    }),
  );

  userCounter += 1;
  const multiCenterUser: DemoUserDefinition = {
    id: buildDemoId('user', userCounter),
    email: `${DEMO_EMAIL_PREFIX}.multi@${DEMO_EMAIL_DOMAIN}`,
    fullName: 'Carlos Navarro',
    memberships: centers.map((center) => nextMembership(center.id, 'client')),
  };

  return [...centerUsers, multiCenterUser];
}

export const DEMO_USERS: readonly DemoUserDefinition[] = buildDemoUsers(DEMO_CENTERS);
