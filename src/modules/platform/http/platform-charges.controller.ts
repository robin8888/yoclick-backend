import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type FastifyReply } from 'fastify';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { CurrentPlatformActor } from '../../../shared/auth/decorators/current-platform-actor.decorator';
import { PlatformRoles } from '../../../shared/auth/decorators/platform-roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import {
  ExportPlatformChargesCsvUseCase,
  GetPlatformChargeReportUseCase,
  ListPlatformChargesUseCase,
  RecordPlatformChargeUseCase,
  UpdatePlatformChargeUseCase,
} from '../application/platform.use-cases';
import { type PlatformCharge } from '../application/ports/platform.repository';
import {
  PlatformChargeListResponseDto,
  PlatformChargeReportQueryDto,
  PlatformChargeReportResponseDto,
  PlatformChargeResponseDto,
  PlatformChargeRouteParamsDto,
  PlatformChargesQueryDto,
  RecordPlatformChargeRequestDto,
  UpdatePlatformChargeRequestDto,
} from './platform-charges.dto';

function serializeCharge(charge: PlatformCharge): Record<string, unknown> {
  return { ...charge, createdAt: charge.createdAt.toISOString() };
}

/**
 * Cobros de los planes e informes para el gestor (docs/spec/17 §3.3). El `admin` los lee y los apunta; el
 * `accountant` (el gestor) solo los lee.
 */
@ApiTags('platform')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('platform')
@PlatformRoles('admin', 'accountant')
@Throttle({ default: RATE_LIMITS.platformAdmin })
export class PlatformChargesController {
  constructor(
    private readonly listCharges: ListPlatformChargesUseCase,
    private readonly recordCharge: RecordPlatformChargeUseCase,
    private readonly updateCharge: UpdatePlatformChargeUseCase,
    private readonly getReport: GetPlatformChargeReportUseCase,
    private readonly exportCsv: ExportPlatformChargesCsvUseCase,
  ) {}

  @Get('charges')
  @ApiOperation({
    operationId: 'platform_list_charges',
    summary: 'Los cobros de los planes, del más reciente al más antiguo, por mes o por centro.',
  })
  @ApiOkResponse({ type: PlatformChargeListResponseDto })
  async charges(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Query() query: PlatformChargesQueryDto,
  ): Promise<unknown> {
    const page = await this.listCharges.execute(actor, query);
    return { data: page.data.map(serializeCharge), nextCursor: page.nextCursor };
  }

  @Post('charges')
  @PlatformRoles('admin')
  @ApiOperation({
    operationId: 'platform_record_charge',
    summary:
      'Apunta a mano un cobro de plan a un centro. El IVA y el total los calcula el servidor a partir de la base y el tipo.',
  })
  @ApiCreatedResponse({ type: PlatformChargeResponseDto })
  async record(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Body() body: RecordPlatformChargeRequestDto,
  ): Promise<unknown> {
    const charge = await this.recordCharge.execute(actor, {
      centerId: body.centerId,
      chargedOn: body.chargedOn,
      concept: body.concept,
      baseCents: body.baseCents,
      vatBasisPoints: body.vatBasisPoints,
      status: body.status,
      paymentMethod: body.paymentMethod,
      invoiceReference: body.invoiceReference ?? null,
      customerLegalName: body.customerLegalName ?? null,
      customerTaxId: body.customerTaxId ?? null,
    });
    return serializeCharge(charge);
  }

  @Patch('charges/:chargeId')
  @PlatformRoles('admin')
  @ApiOperation({
    operationId: 'platform_update_charge',
    summary:
      'Cambia el estado de un cobro (cobrado, pendiente, anulado) o su referencia de factura. Un cobro anulado ya no se cambia.',
  })
  @ApiOkResponse({ type: PlatformChargeResponseDto })
  async update(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Param() params: PlatformChargeRouteParamsDto,
    @Body() body: UpdatePlatformChargeRequestDto,
  ): Promise<unknown> {
    return serializeCharge(await this.updateCharge.execute(actor, params.chargeId, body));
  }

  @Get('reports/monthly')
  @ApiOperation({
    operationId: 'platform_get_charge_report',
    summary:
      'Lo cobrado mes a mes entre dos meses (base, IVA, total, comisiones y número de cobros) y el total del rango.',
  })
  @ApiOkResponse({ type: PlatformChargeReportResponseDto })
  async report(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Query() query: PlatformChargeReportQueryDto,
  ): Promise<unknown> {
    return this.getReport.execute(actor, query);
  }

  @Get('reports/export.csv')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'platform_export_charges_csv',
    summary:
      'El CSV de los cobros cobrados entre dos meses, para el gestor (separador «;» y coma decimal).',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string' } })
  async exportReport(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Query() query: PlatformChargeReportQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const csv = await this.exportCsv.execute(actor, query);
    void reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="cobros-${query.fromMonth}-${query.toMonth}.csv"`,
      )
      .header('x-content-type-options', 'nosniff');
    return csv;
  }
}
