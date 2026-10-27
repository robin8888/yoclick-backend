import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../database/tenant-prisma.service';
import { type PlanAccessFacts } from './plan-access';

export interface CenterPlan extends PlanAccessFacts {
  readonly planId: string;
}

/** Lee el plan de un centro y lo necesario para saber si debe contratar uno. */
@Injectable()
export class CenterPlanFinder {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  /** Un centro que no existe devuelve `null`: la ruta responderá lo suyo. */
  async find(centerId: string): Promise<CenterPlan | null> {
    const center = await this.tenantPrismaService.runInCenterLookupContext({ centerId }, (client) =>
      client.center.findUnique({
        where: { id: centerId },
        select: {
          planId: true,
          status: true,
          trialEndsAt: true,
          graceEndsAt: true,
          stripeSubscriptionId: true,
        },
      }),
    );
    if (center === null) return null;
    return {
      planId: center.planId,
      status: center.status,
      trialEndsAt: center.trialEndsAt,
      graceEndsAt: center.graceEndsAt,
      hasSubscription: center.stripeSubscriptionId !== null,
    };
  }
}
