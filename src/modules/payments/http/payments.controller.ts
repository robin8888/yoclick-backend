import { RequiresModule } from '../../../shared/auth/decorators/requires-module.decorator';
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type FastifyRequest } from 'fastify';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import {
  ConfirmPaymentUseCase,
  GetPaymentsStatusUseCase,
  HandleStripeWebhookUseCase,
  ListPaymentsUseCase,
  OpenPaymentsDashboardUseCase,
  PayTargetUseCase,
  StartPaymentsOnboardingUseCase,
} from '../application/payment.use-cases';
import {
  CenterRouteParamsDto,
  OnboardingLinkResponseDto,
  PassPaymentRouteParamsDto,
  PaymentListResponseDto,
  PaymentConfirmationResponseDto,
  PaymentRouteParamsDto,
  PaymentSheetResponseDto,
  PaymentsStatusResponseDto,
} from './payment.dto';
import { serializePaymentItem } from './serialize-payments';

@ApiTags('payments')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class PaymentsConnectController {
  constructor(
    private readonly startOnboarding: StartPaymentsOnboardingUseCase,
    private readonly openDashboard: OpenPaymentsDashboardUseCase,
  ) {}

  @Post('payments/connect/onboarding-link')
  @Roles('owner')
  @ApiOperation({
    operationId: 'payments_start_onboarding',
    summary:
      'Abre (o retoma) el alta de cobros del centro en Stripe y devuelve el enlace de un solo uso. 403 PAYMENTS_NOT_INCLUDED si el plan no es Premium.',
  })
  @ApiCreatedResponse({ type: OnboardingLinkResponseDto })
  async onboardingLink(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.startOnboarding.execute(actor)) };
  }

  @Post('payments/connect/dashboard-link')
  @Roles('owner')
  @ApiOperation({
    operationId: 'payments_open_dashboard',
    summary:
      'Enlace al panel de Stripe del centro (reembolsos, disputas, pagos a su banco). 409 PAYMENTS_NOT_READY si aún no cobra.',
  })
  @ApiCreatedResponse({ type: OnboardingLinkResponseDto })
  async dashboardLink(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.openDashboard.execute(actor)) };
  }
}

@ApiTags('payments')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class PaymentsController {
  constructor(
    private readonly getStatus: GetPaymentsStatusUseCase,
    private readonly listPayments: ListPaymentsUseCase,
    private readonly payTarget: PayTargetUseCase,
    private readonly confirmPayment: ConfirmPaymentUseCase,
  ) {}

  @Get('payments/status')
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'payments_get_status',
    summary:
      'Si el centro cobra online: `not_included` (plan sin cobros), `not_started`, `pending` (alta en Stripe sin terminar) o `ready`.',
  })
  @ApiOkResponse({ type: PaymentsStatusResponseDto })
  async status(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.getStatus.execute(actor)) };
  }

  @Get('payments')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'payments_list',
    summary: 'Los últimos 50 cobros online del centro, de más reciente a más antiguo.',
  })
  @ApiOkResponse({ type: PaymentListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const payments = await this.listPayments.execute(actor);
    return { payments: payments.map(serializePaymentItem) };
  }

  @RequiresModule('passes')
  @Post('passes/:passId/pay')
  @Roles('client')
  @ApiOperation({
    operationId: 'payments_pay_pass',
    summary:
      'Prepara el pago online de un bono pendiente de la propia persona. 409 PAYMENTS_NOT_READY si el centro no terminó el alta.',
  })
  @ApiCreatedResponse({ type: PaymentSheetResponseDto })
  async payPass(
    @CurrentActor() actor: ActorContext,
    @Param() params: PassPaymentRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return {
      ...(await this.payTarget.execute(actor, { kind: 'pass', id: params.passId })),
    };
  }

  @Post('payments/:paymentId/confirm')
  @Roles('client')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'payments_confirm',
    summary:
      'Tras cerrar la hoja de pago: el servidor lo comprueba en Stripe y, si está pagado, activa lo comprado.',
  })
  @ApiOkResponse({ type: PaymentConfirmationResponseDto })
  async confirm(
    @CurrentActor() actor: ActorContext,
    @Param() params: PaymentRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.confirmPayment.execute(actor, params.paymentId)) };
  }
}

@ApiTags('payments')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(private readonly handleWebhook: HandleStripeWebhookUseCase) {}

  @Post('stripe')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'webhooks_stripe',
    summary:
      'Avisos de Stripe. Verifica la firma `Stripe-Signature` (SEC-66) y relee el cobro antes de dar nada por pagado.',
  })
  @ApiNoContentResponse()
  async stripe(@Req() request: FastifyRequest): Promise<void> {
    const signature = request.headers['stripe-signature'];
    if (request.rawBody === undefined) throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    await this.handleWebhook.execute({
      rawBody: request.rawBody,
      signatureHeader: typeof signature === 'string' ? signature : undefined,
    });
  }
}
