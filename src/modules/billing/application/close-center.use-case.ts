import { Inject, Injectable } from '@nestjs/common';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { BILLING_GATEWAY, type BillingGateway } from './ports/billing-gateway';
import {
  BILLING_REPOSITORY,
  type BillingRepository,
  type CenterMemberRef,
  type OwnedCenterRef,
} from './ports/billing.repository';

export interface CloseCenterInput {
  readonly centerId: string;
  /** Quien cierra el centro: no recibe el aviso de cierre, ya lo sabe. */
  readonly closedByUserId: string;
}

/**
 * Cierra un centro de forma definitiva cuando su único propietario elimina la cuenta (Apple 5.1.1(v)).
 *
 * Qué hace: cancela la suscripción en Stripe en el acto, marca el centro como cerrado, avisa a todos los que
 * estaban dentro (menos a quien lo cierra), los saca del centro y lo deja anotado en la auditoría.
 *
 * Qué NO hace, a propósito: no borra datos. Las facturas y los recibos tienen plazo legal de conservación,
 * así que la purga posterior de un centro cerrado queda pendiente de revisión legal.
 *
 * Es idempotente: si el centro ya está cerrado no hace nada, así que se puede reintentar tras un fallo.
 */
@Injectable()
export class CloseCenterUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
    private readonly pushDispatcher: PushDispatcher,
  ) {}

  /** Los centros que esta persona dejaría sin responsable: aquellos de los que es la única propietaria. */
  listCentersSolelyOwnedBy(userId: string): Promise<OwnedCenterRef[]> {
    return this.billing.runInTransaction((transaction) =>
      transaction.listCentersSolelyOwnedBy(userId),
    );
  }

  async execute(input: CloseCenterInput): Promise<void> {
    const facts = await this.billing.runInTransaction((transaction) =>
      transaction.findCenterForClosure(input.centerId),
    );
    if (facts === null || facts.closedAt !== null) return;

    // Primero Stripe: si falla, el centro sigue abierto y se puede reintentar sin haber dejado nada a medias.
    if (facts.stripeSubscriptionId !== null) {
      await this.gateway.cancelSubscription(facts.stripeSubscriptionId);
    }
    const notifiedMember = await this.billing.runInTransaction(async (transaction) => {
      const members = await transaction.listActiveMembers(input.centerId);
      const recipients = members.filter((member) => member.userId !== input.closedByUserId);
      await transaction.markCenterClosed(input.centerId, new Date());
      await transaction.notifyCenterClosed({
        centerId: input.centerId,
        recipientMembershipIds: recipients.map((member) => member.membershipId),
        data: { centerName: facts.name },
      });
      await transaction.endAllMemberships(input.centerId);
      await transaction.writeAudit({
        centerId: input.centerId,
        action: 'center_closed',
        details: { hadSubscription: facts.stripeSubscriptionId !== null },
      });
      return recipients[0];
    });
    await this.flushPush(input.centerId, notifiedMember);
  }

  /** Tras confirmar: el push nunca debe deshacer el cierre. */
  private async flushPush(centerId: string, member: CenterMemberRef | undefined): Promise<void> {
    if (member === undefined) return;
    await this.pushDispatcher.flushCenter({
      userId: member.userId,
      centerId,
      membershipId: member.membershipId,
      role: member.role,
      permissions: [],
    });
  }
}
