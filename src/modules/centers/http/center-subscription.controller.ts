import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PLAN_FEATURE_IDS } from '../../../shared/centers/plan-features';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { AllowWithoutPlan } from '../../../shared/auth/decorators/requires-plan-feature.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { GetCenterSubscriptionUseCase } from '../application/get-center-subscription.use-case';
import { CenterRouteParamsDto } from './center-settings.dto';

class CenterSubscriptionResponseDto extends createZodDto(
  z.strictObject({
    status: z.enum(['trial', 'active', 'past_due', 'suspended']),
    /** Fin de la prueba gratuita; `null` si no hay prueba en curso. */
    trialEndsAt: z.iso.datetime().nullable(),
    /** Plan contratado (en la prueba es Pro). */
    planId: z.enum(['basic', 'pro', 'premium']),
    /** Cada cuánto paga; `null` si todavía no ha contratado el plan. */
    billingPeriod: z.enum(['monthly', 'annual']).nullable(),
    /** Fin de los 7 días de gracia tras un pago fallido; `null` si no está en gracia. */
    graceEndsAt: z.iso.datetime().nullable(),
    /** Ya paga con una suscripción de Stripe. */
    hasSubscription: z.boolean(),
    /** Debe contratar un plan para seguir gestionando el centro: prueba acabada, impago sin gracia o suspendido. */
    isPlanRequired: z.boolean(),
    /** Funciones que da el plan además de los topes. */
    features: z.array(z.enum(PLAN_FEATURE_IDS)),
    /** Tope de clientes activos del plan; `null` si no tiene. */
    maxClients: z.number().int().nullable(),
    activeClientCount: z.number().int(),
    /** Espacio de vídeo contratado en bytes (plan Premium); `null` si el plan no incluye vídeo. */
    videoStorageLimitBytes: z.number().int().nullable(),
    videoStorageUsedBytes: z.number().int(),
    /** Espacio de fotos de la galería del equipo: tope del plan y lo que ocupan. */
    photoStorage: z.strictObject({
      usedBytes: z.number().int().nonnegative(),
      limitBytes: z.number().int().nonnegative(),
    }),
  }),
) {}

@ApiTags('centers')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@AllowWithoutPlan()
@Controller('centers/:centerId/subscription')
export class CenterSubscriptionController {
  constructor(private readonly getSubscription: GetCenterSubscriptionUseCase) {}

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'centers_get_subscription',
    summary:
      'Estado del plan del centro: prueba o activo, fin de la prueba, tope de clientes y cuántos hay activos. La suscripción se gestiona y se paga en la web.',
  })
  @ApiOkResponse({ type: CenterSubscriptionResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const subscription = await this.getSubscription.execute(actor);
    return {
      ...subscription,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
    };
  }
}
