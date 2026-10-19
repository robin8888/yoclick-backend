import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { GetReceiptUseCase, ListMyPaymentsUseCase } from '../application/payment.use-cases';
import {
  CenterRouteParamsDto,
  PaymentListResponseDto,
  PaymentRouteParamsDto,
  ReceiptResponseDto,
} from './payment.dto';
import { serializePaymentItem, serializeReceipt } from './serialize-payments';

/** Los cobros pagados de la persona y sus recibos (los precios llevan el IVA incluido). */
@ApiTags('payments')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class PaymentReceiptsController {
  constructor(
    private readonly listMyPayments: ListMyPaymentsUseCase,
    private readonly getReceipt: GetReceiptUseCase,
  ) {}

  @Get('payments/mine')
  @Roles('client')
  @ApiOperation({
    operationId: 'payments_list_mine',
    summary: 'Los cobros ya pagados de la propia persona, con el número de su recibo.',
  })
  @ApiOkResponse({ type: PaymentListResponseDto })
  async listMine(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { payments: (await this.listMyPayments.execute(actor)).map(serializePaymentItem) };
  }

  @Get('payments/:paymentId/receipt')
  @Roles('owner', 'admin', 'client')
  @ApiOperation({
    operationId: 'payments_get_receipt',
    summary:
      'El recibo de un cobro pagado, con la base imponible y el IVA (los precios lo llevan incluido). La persona cliente solo ve los suyos; 404 si no existe o aún no está pagado.',
  })
  @ApiOkResponse({ type: ReceiptResponseDto })
  async receipt(
    @CurrentActor() actor: ActorContext,
    @Param() params: PaymentRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializeReceipt(await this.getReceipt.execute(actor, params.paymentId));
  }
}
