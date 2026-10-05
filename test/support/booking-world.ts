import { randomUUID } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type LightMyRequestResponse } from 'fastify';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { type MembershipRoleName } from '../../src/shared/tenancy/actor-context';
import { addDaysToLocalDate, toLocalDate } from '../../src/shared/time/zoned-time';
import { DatabaseFixtures } from './database-fixtures';

export interface CreatedTestCenter {
  readonly centerId: string;
  readonly ownerMembershipId: string;
  readonly joinCode: string;
}

export interface TestSlot {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly staffMembershipId: string;
  readonly staffName: string;
}

export interface TestService {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly staff: { membershipId: string; fullName: string }[];
}

interface CallOptions {
  readonly centerId?: string;
  readonly body?: object;
  /** Cuerpo en bruto, para probar JSON mal formado. */
  readonly rawBody?: string;
  readonly headers?: Record<string, string>;
  /** Por defecto la sesión lleva segundo factor, como la de quien administra un centro. */
  readonly isMfaVerified?: boolean;
}

const MILLISECONDS_PER_HOUR = 3_600_000;
const AVAILABILITY_SPAN_DAYS = 13;
const MADRID = 'Europe/Madrid';
const ALL_DAY_SHIFT = [{ opensAt: '00:00', closesAt: '23:59' }];

/**
 * Escenario de pruebas de servicios y reservas: llama a la API real (con los mismos guards, RLS y
 * validación que producción) como cada persona, y crea centros y miembros por el camino público.
 */
export class BookingWorld {
  readonly fixtures: DatabaseFixtures;
  readonly tenantPrismaService: TenantPrismaService;
  private readonly accessTokenService: AccessTokenService;

  constructor(private readonly application: NestFastifyApplication) {
    this.accessTokenService = application.get(AccessTokenService);
    this.tenantPrismaService = application.get(TenantPrismaService);
    this.fixtures = new DatabaseFixtures(application.get(PrismaService), this.tenantPrismaService);
  }

  async call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    userId: string | undefined,
    options: CallOptions = {},
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.centerId) headers['x-center-id'] = options.centerId;
    if (userId) {
      const { token } = await this.accessTokenService.issue(userId, {
        isMfaVerified: options.isMfaVerified ?? true,
      });
      headers['authorization'] = `Bearer ${token}`;
    }
    return this.application.inject({
      method,
      url,
      headers,
      ...(options.body && { payload: options.body }),
      ...(options.rawBody !== undefined && { payload: options.rawBody }),
    });
  }

  async createCenter(ownerUserId: string, name = 'Dojo Test'): Promise<CreatedTestCenter> {
    const response = await this.call('POST', '/v1/onboarding/centers', ownerUserId, {
      headers: { 'idempotency-key': randomUUID() },
      body: { name, sectorId: 'marciales' },
    });
    if (response.statusCode !== 201) throw new Error(`Could not create center: ${response.body}`);
    return response.json<CreatedTestCenter>();
  }

  /** Abre el centro todos los días las 24 horas: así siempre hay huecos, sea la hora o el día que sea. */
  async openAllWeek(ownerUserId: string, centerId: string): Promise<void> {
    const current = await this.call('GET', `/v1/centers/${centerId}`, ownerUserId, { centerId });
    const etag = current.headers['etag'];
    const openingHours = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, ALL_DAY_SHIFT]),
    );
    const response = await this.call('PATCH', `/v1/centers/${centerId}`, ownerUserId, {
      centerId,
      headers: { 'if-match': String(etag) },
      body: { openingHours },
    });
    if (response.statusCode !== 200) throw new Error(`Could not open the center: ${response.body}`);
  }

  async addMember(
    centerId: string,
    prefix: string,
    role: MembershipRoleName,
  ): Promise<{ userId: string; membershipId: string }> {
    const userId = await this.fixtures.createUser(prefix);
    const membershipId = await this.fixtures.createMembership({ centerId, userId, role });
    return { userId, membershipId };
  }

  async listServices(userId: string, centerId: string): Promise<TestService[]> {
    const response = await this.call('GET', `/v1/centers/${centerId}/services`, userId, {
      centerId,
    });
    return response.json<{ services: TestService[] }>().services;
  }

  async createService(ownerUserId: string, centerId: string, body: object): Promise<TestService> {
    const response = await this.call('POST', `/v1/centers/${centerId}/services`, ownerUserId, {
      centerId,
      body,
    });
    if (response.statusCode !== 201) throw new Error(`Could not create service: ${response.body}`);
    return response.json<TestService>();
  }

  /** Huecos de los próximos 14 días (hoy incluido, en la zona del centro), con filtro opcional de equipo. */
  async fetchSlots(
    userId: string,
    centerId: string,
    serviceId: string,
    staffMembershipId?: string,
  ): Promise<TestSlot[]> {
    const today = toLocalDate(new Date(), MADRID);
    const query = new URLSearchParams({
      serviceId,
      from: today,
      to: addDaysToLocalDate(today, AVAILABILITY_SPAN_DAYS),
      ...(staffMembershipId && { staffMembershipId }),
    });
    const response = await this.call(
      'GET',
      `/v1/centers/${centerId}/availability?${query.toString()}`,
      userId,
      {
        centerId,
      },
    );
    if (response.statusCode !== 200) throw new Error(`Availability failed: ${response.body}`);
    return response.json<{ days: { slots: TestSlot[] }[] }>().days.flatMap((day) => day.slots);
  }

  async book(
    userId: string,
    centerId: string,
    body: object,
    idempotencyKey: string = randomUUID(),
  ): Promise<LightMyRequestResponse> {
    return this.call('POST', `/v1/centers/${centerId}/bookings`, userId, {
      centerId,
      body,
      headers: { 'idempotency-key': idempotencyKey },
    });
  }
}

/** El primer hueco que empieza al menos `hours` horas después de ahora (y, si se pide, antes de `before`). */
export function firstSlotAtLeast(
  slots: readonly TestSlot[],
  hours: number,
  beforeHours = Number.POSITIVE_INFINITY,
): TestSlot {
  const slot = slots.find((candidate) => {
    const hoursAhead = (Date.parse(candidate.startsAt) - Date.now()) / MILLISECONDS_PER_HOUR;
    return hoursAhead >= hours && hoursAhead < beforeHours;
  });
  if (!slot)
    throw new Error(`No slot between ${String(hours)} and ${String(beforeHours)} hours ahead`);
  return slot;
}

/** La fecha local del centro (Madrid) en la que cae un instante UTC, como la que usan /availability y /agenda. */
export function localDateOf(isoInstant: string): string {
  return toLocalDate(new Date(isoInstant), MADRID);
}
