import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { AllowWithoutPlan } from '../../../shared/auth/decorators/requires-plan-feature.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { CenterRouteParamsDto } from '../../centers/http/center-settings.dto';
import {
  CreateCheckoutSessionUseCase,
  CreatePortalSessionUseCase,
  ListPlanOffersUseCase,
} from '../application/billing.use-cases';

class CheckoutRequestDto extends createZodDto(
  z.strictObject({
    planId: z.enum(['basic', 'pro', 'premium']),
    /** `monthly` paga mes a mes; `annual` paga el año entero al precio anual. */
    period: z.enum(['monthly', 'annual']),
  }),
) {}

class PlanOffersResponseDto extends createZodDto(
  z.strictObject({
    plans: z.array(
      z.strictObject({
        id: z.enum(['basic', 'pro', 'premium']),
        name: z.string(),
        /** Céntimos al mes, sin IVA, pagando mes a mes. */
        monthlyPriceCents: z.number().int(),
        /** Céntimos por mes, sin IVA, pagando el año entero (se cobra por doce). */
        annualMonthlyPriceCents: z.number().int(),
        /** Cuota de alta, una sola vez, en el primer cobro; 0 si no la hay. */
        setupFeeCents: z.number().int(),
        /** Tope de clientes activos; `null` = sin tope. */
        maxClients: z.number().int().nullable(),
        documentStorageLimitBytes: z.number().int(),
        /** `null` = el plan no incluye vídeo. */
        videoStorageLimitBytes: z.number().int().nullable(),
        /** Funciones que da el plan además de los topes; cada plan suma las del anterior. */
        features: z.array(z.enum(PLAN_FEATURE_IDS)),
        /** Se puede contratar ya: sus precios existen en Stripe. */
        isAvailable: z.boolean(),
      }),
    ),
  }),
) {}

class CheckoutResponseDto extends createZodDto(
  z.strictObject({
    /** Página de pago de Stripe: se abre en el navegador, nunca dentro de la app. */
    url: z.url(),
  }),
) {}

@ApiTags('centers')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@AllowWithoutPlan()
@Controller('centers/:centerId/subscription')
export class BillingController {
  constructor(
    private readonly listPlanOffers: ListPlanOffersUseCase,
    private readonly createCheckoutSession: CreateCheckoutSessionUseCase,
    private readonly createPortalSession: CreatePortalSessionUseCase,
  ) {}

  @Get('plans')
  @Roles('owner')
  @ApiOperation({
    operationId: 'centers_list_subscription_plans',
    summary:
      'Los planes que se pueden contratar, con su precio mensual y anual (sin IVA), la cuota de alta y lo que incluye cada uno.',
  })
  @ApiOkResponse({ type: PlanOffersResponseDto })
  async plans(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<{ plans: unknown[] }> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { plans: await this.listPlanOffers.execute(actor) };
  }

  @Post('portal')
  @Roles('owner')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'centers_create_subscription_portal',
    summary:
      'Da el enlace al portal de Stripe para cambiar de plan o de periodicidad, cambiar la tarjeta, ver las facturas o cancelar. Solo si el centro ya ha pagado alguna vez; se abre en el navegador.',
  })
  @ApiOkResponse({ type: CheckoutResponseDto })
  async portal(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<{ url: string }> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return this.createPortalSession.execute(actor);
  }

  @Post('checkout')
  @Roles('owner')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'centers_create_subscription_checkout',
    summary:
      'Da la página de pago de Stripe para contratar un plan. Si la prueba sigue en marcha, el primer cobro se aplaza hasta que acabe. El pago se hace en la web, no en la app.',
  })
  @ApiOkResponse({ type: CheckoutResponseDto })
  async checkout(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CheckoutRequestDto,
  ): Promise<{ url: string }> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return this.createCheckoutSession.execute(actor, body);
  }
}
