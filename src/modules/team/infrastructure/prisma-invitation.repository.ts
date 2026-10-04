import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type AcceptInvitationCommand,
  type AcceptInvitationOutcome,
  type InvitationPreview,
  type InvitationRepository,
  type NewInvitation,
  type PendingInvitation,
} from '../application/ports/invitation.repository';
import { higherRole } from '../domain/team-rules';

type InvitationRow = NonNullable<
  Awaited<ReturnType<TenantTransactionClient['invitation']['findUnique']>>
>;

function isUsable(invitation: InvitationRow | null, now: Date): invitation is InvitationRow {
  return (
    invitation !== null &&
    invitation.acceptedAt === null &&
    invitation.revokedAt === null &&
    invitation.expiresAt > now
  );
}

@Injectable()
export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findCenterName(actor: ActorContext): Promise<string | null> {
    const center = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.center.findUnique({ where: { id: actor.centerId }, select: { name: true } }),
    );
    return center?.name ?? null;
  }

  async hasMemberWithEmail(actor: ActorContext, email: string): Promise<boolean> {
    const count = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.membership.count({
        where: { status: { in: ['active', 'blocked'] }, user: { email } },
      }),
    );
    return count > 0;
  }

  async createReplacingPending(
    actor: ActorContext,
    invitation: NewInvitation,
    now: Date,
  ): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.invitation.updateMany({
        where: { email: invitation.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      await client.invitation.create({ data: { ...invitation, centerId: actor.centerId } });
    });
  }

  async listPending(actor: ActorContext, now: Date): Promise<PendingInvitation[]> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.invitation.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  }

  async revoke(actor: ActorContext, invitationId: string, now: Date): Promise<boolean> {
    const result = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.invitation.updateMany({
        where: { id: invitationId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      }),
    );
    return result.count === 1;
  }

  async findPreview(tokenHash: string, now: Date): Promise<InvitationPreview | null> {
    const invitation = await this.tenantPrismaService.runInCenterLookupContext(
      { invitationTokenHash: tokenHash },
      (client) => client.invitation.findUnique({ where: { tokenHash } }),
    );
    if (!isUsable(invitation, now)) return null;

    const center = await this.tenantPrismaService.runInCenterLookupContext(
      { centerId: invitation.centerId },
      (client) =>
        client.center.findUnique({
          where: { id: invitation.centerId },
          select: { id: true, name: true, sectorId: true, brandColor: true, status: true },
        }),
    );
    if (!center || center.status === 'suspended') return null;
    return {
      role: invitation.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      center: {
        id: center.id,
        name: center.name,
        sectorId: center.sectorId,
        brandColor: center.brandColor,
      },
    };
  }

  async accept(command: AcceptInvitationCommand): Promise<AcceptInvitationOutcome> {
    const { tokenHash, userId, now } = command;
    const invitation = await this.tenantPrismaService.runInCenterLookupContext(
      { invitationTokenHash: tokenHash },
      (client) => client.invitation.findUnique({ where: { tokenHash } }),
    );
    const userEmail = await this.findUserEmail(userId);
    if (!isUsable(invitation, now) || invitation.email !== userEmail) return { kind: 'invalid' };

    const actor = {
      userId,
      centerId: invitation.centerId,
      membershipId: '',
      role: 'client',
      permissions: [],
    } as const;
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      // Bloquear el centro serializa las aceptaciones: el tope de clientes no se salta con códigos simultáneos.
      await client.$queryRaw`select id from centers where id = ${invitation.centerId}::uuid for update`;
      return this.acceptWithinCenter(client, { invitation, userId, now });
    });
  }

  private async findUserEmail(userId: string): Promise<string | null> {
    const user = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.user.findUnique({ where: { id: userId }, select: { email: true } }),
    );
    return user?.email.toLowerCase() ?? null;
  }

  private async acceptWithinCenter(
    client: TenantTransactionClient,
    context: { invitation: InvitationRow; userId: string; now: Date },
  ): Promise<AcceptInvitationOutcome> {
    const { invitation, userId, now } = context;
    const { centerId } = invitation;
    const existing = await client.membership.findUnique({
      where: { centerId_userId: { centerId, userId } },
    });
    if (existing?.status === 'blocked') return { kind: 'membership_blocked' };

    const isLimitCheckNeeded = invitation.role === 'client' && existing?.status !== 'active';
    if (isLimitCheckNeeded && (await this.isClientLimitReached(client, centerId))) {
      return { kind: 'client_limit_reached' };
    }

    const consumed = await client.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (consumed.count !== 1) return { kind: 'invalid' };

    const membership = existing
      ? await client.membership.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            // Quien volvió tras irse parte del rol de la invitación; quien sigue dentro nunca baja.
            role:
              existing.status === 'left'
                ? invitation.role
                : higherRole(existing.role, invitation.role),
          },
        })
      : await client.membership.create({
          data: { id: generateUuidV7(), centerId, userId, role: invitation.role, status: 'active' },
        });
    return { kind: 'accepted', membership };
  }

  private async isClientLimitReached(
    client: TenantTransactionClient,
    centerId: string,
  ): Promise<boolean> {
    const center = await client.center.findUniqueOrThrow({
      where: { id: centerId },
      select: { maxClients: true },
    });
    if (center.maxClients === null) return false;
    const activeClients = await client.membership.count({
      where: { centerId, role: 'client', status: 'active' },
    });
    return activeClients >= center.maxClients;
  }
}
