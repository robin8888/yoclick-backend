import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordHasher } from '../shared/auth/password-hasher';
import { type Environment } from '../shared/config/environment.schema';
import { TenantPrismaService } from '../shared/database/tenant-prisma.service';
import { type ActorContext } from '../shared/tenancy/actor-context';
import {
  DEMO_CENTERS,
  DEMO_PASSWORD,
  DEMO_USERS,
  type DemoCenterDefinition,
  type DemoUserDefinition,
} from './demo-data';

export interface DemoSeedSummary {
  readonly centerCount: number;
  readonly userCount: number;
  readonly membershipCount: number;
}

/** Quien "ejecuta" el seed. No es una persona: solo da contexto de centro a las políticas RLS. */
const SEED_ACTOR_ID = '01930000-0000-7000-8000-000000000000';

/**
 * Siembra los centros y las cuentas de demo. Idempotente: se puede ejecutar cuantas veces haga falta;
 * actualiza lo que ya existe (y devuelve la contraseña de demo a quien la hubiera cambiado probando).
 */
@Injectable()
export class DemoSeeder {
  constructor(
    private readonly tenantPrismaService: TenantPrismaService,
    private readonly passwordHasher: PasswordHasher,
    private readonly configService: ConfigService<Environment, true>,
  ) {}

  async run(): Promise<DemoSeedSummary> {
    this.assertNotRunningInProduction();

    await Promise.all(DEMO_USERS.map((demoUser) => this.upsertUser(demoUser)));
    for (const demoCenter of DEMO_CENTERS) await this.upsertCenterWithMemberships(demoCenter);

    return {
      centerCount: DEMO_CENTERS.length,
      userCount: DEMO_USERS.length,
      membershipCount: DEMO_USERS.reduce((total, user) => total + user.memberships.length, 0),
    };
  }

  /** La contraseña de demo es pública: en producción equivaldría a dejar cuentas con clave conocida. */
  private assertNotRunningInProduction(): void {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error(
        'The demo seed must never run in production: it uses a publicly known password.',
      );
    }
  }

  private async upsertUser(demoUser: DemoUserDefinition): Promise<void> {
    const passwordHash = await this.passwordHasher.hash(DEMO_PASSWORD);
    const now = new Date();
    // `users` es global (sin RLS): el contexto de usuario basta para escribir en ella.
    await this.tenantPrismaService.runInUserContext(demoUser.id, (client) =>
      client.user.upsert({
        // Por id y no por correo: así un cambio de dirección actualiza la cuenta en lugar de chocar con ella.
        where: { id: demoUser.id },
        create: {
          id: demoUser.id,
          email: demoUser.email,
          passwordHash,
          fullName: demoUser.fullName,
          emailVerifiedAt: now,
        },
        update: {
          email: demoUser.email,
          passwordHash,
          fullName: demoUser.fullName,
          emailVerifiedAt: now,
        },
      }),
    );
  }

  private async upsertCenterWithMemberships(demoCenter: DemoCenterDefinition): Promise<void> {
    const seedActor: ActorContext = {
      userId: SEED_ACTOR_ID,
      centerId: demoCenter.id,
      membershipId: SEED_ACTOR_ID,
      role: 'owner',
      permissions: [],
    };
    const { id: centerId, ...demoCenterFields } = demoCenter;
    const centerFields = { ...demoCenterFields, status: 'active' } as const;

    await this.tenantPrismaService.runInTenantContext(seedActor, async (client) => {
      await client.center.upsert({
        where: { id: centerId },
        create: { id: centerId, ...centerFields },
        update: centerFields,
      });

      for (const demoUser of DEMO_USERS) {
        for (const membership of demoUser.memberships) {
          if (membership.centerId !== demoCenter.id) continue;
          await client.membership.upsert({
            where: { centerId_userId: { centerId: demoCenter.id, userId: demoUser.id } },
            create: {
              id: membership.id,
              centerId: demoCenter.id,
              userId: demoUser.id,
              role: membership.role,
              status: 'active',
            },
            update: { role: membership.role, status: 'active' },
          });
        }
      }
    });
  }
}
