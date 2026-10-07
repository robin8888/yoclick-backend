import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
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
    /** Tope de clientes activos del plan; `null` si no tiene. */
    maxClients: z.number().int().nullable(),
    activeClientCount: z.number().int(),
  }),
) {}

@ApiTags('centers')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
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
    return { ...subscription, trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null };
  }
}
