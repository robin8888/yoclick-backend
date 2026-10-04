import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type ConsentState,
  type MyMembership,
  type NewConsentChange,
  type Profile,
  type ProfilePatch,
  type ProfileRepository,
} from '../application/ports/profile.repository';

const ISO_DATE_LENGTH = 10;

interface ProfileRow {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  birthDate: Date | null;
  locale: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

const PROFILE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  birthDate: true,
  locale: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, ISO_DATE_LENGTH) : null,
    locale: row.locale,
    isEmailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt,
  };
}

/** Las fechas sin hora se guardan como medianoche UTC: la sesión está en UTC, así que no se desplazan. */
function toDatabaseDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

@Injectable()
export class PrismaProfileRepository implements ProfileRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async getProfile(userId: string): Promise<Profile | null> {
    const row = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.user.findFirst({ where: { id: userId, deletedAt: null }, select: PROFILE_SELECT }),
    );
    return row ? toProfile(row) : null;
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<Profile | null> {
    const row = await this.tenantPrismaService.runInUserContext(userId, async (client) => {
      const existing = await client.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) return null;

      return client.user.update({
        where: { id: userId },
        select: PROFILE_SELECT,
        // Se copian campo a campo, nunca el objeto entero del cliente (SEC-48).
        data: {
          ...(patch.fullName !== undefined && { fullName: patch.fullName }),
          ...(patch.phone !== undefined && { phone: patch.phone }),
          ...(patch.locale !== undefined && { locale: patch.locale }),
          ...(patch.birthDate !== undefined && {
            birthDate: patch.birthDate === null ? null : toDatabaseDate(patch.birthDate),
          }),
        },
      });
    });
    return row ? toProfile(row) : null;
  }

  async listMemberships(userId: string): Promise<MyMembership[]> {
    const rows = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.membership.findMany({
        where: { userId, status: { not: 'left' } },
        orderBy: { joinedAt: 'asc' },
        include: {
          center: { select: { name: true, slug: true, sectorId: true, brandColor: true } },
        },
      }),
    );
    return rows.map((row) => ({
      membershipId: row.id,
      centerId: row.centerId,
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt,
      center: row.center,
    }));
  }

  async listLatestConsents(userId: string): Promise<ConsentState[]> {
    const rows = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.consent.findMany({
        distinct: ['kind'],
        // El id es UUIDv7 (ordenado por tiempo): desempata dos cambios en el mismo milisegundo.
        orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    return rows.map(({ kind, version, isGranted, grantedAt }) => ({
      kind,
      version,
      isGranted,
      grantedAt,
    }));
  }

  async listConsentHistory(userId: string): Promise<ConsentState[]> {
    const rows = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.consent.findMany({ orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }] }),
    );
    return rows.map(({ kind, version, isGranted, grantedAt }) => ({
      kind,
      version,
      isGranted,
      grantedAt,
    }));
  }

  async recordConsent(userId: string, change: NewConsentChange): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.consent.create({
        data: {
          id: generateUuidV7(),
          userId,
          kind: change.kind,
          version: change.version,
          isGranted: change.isGranted,
        },
      }),
    );
  }
}
