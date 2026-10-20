import { RequiresModule } from '../../../shared/auth/decorators/requires-module.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import {
  ArchiveRateUseCase,
  AssignPassUseCase,
  CancelPassUseCase,
  CreateRateUseCase,
  DecidePassUseCase,
  ListEligibleClientsUseCase,
  ListPassesUseCase,
  ListRatesUseCase,
  RequestPassUseCase,
  UpdateRateUseCase,
} from '../application/pass.use-cases';
import { type PassView } from '../application/ports/pass.repository';
import {
  AssignPassRequestDto,
  CenterRouteParamsDto,
  CreateRateRequestDto,
  EligibleClientsQueryDto,
  EligibleClientsResponseDto,
  PassListQueryDto,
  PassListResponseDto,
  PassResponseDto,
  PassRouteParamsDto,
  RateListResponseDto,
  RateResponseDto,
  RateRouteParamsDto,
  UpdateRateRequestDto,
} from './pass.dto';

function serializePass(pass: PassView): Record<string, unknown> {
  return {
    ...pass,
    requestedAt: pass.requestedAt.toISOString(),
    startsAt: pass.startsAt?.toISOString() ?? null,
    expiresAt: pass.expiresAt?.toISOString() ?? null,
  };
}

@ApiTags('rates')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/rates')
export class RatesController {
  constructor(
    private readonly listRates: ListRatesUseCase,
    private readonly createRate: CreateRateUseCase,
    private readonly updateRate: UpdateRateUseCase,
    private readonly archiveRate: ArchiveRateUseCase,
    private readonly requestPass: RequestPassUseCase,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'rates_list',
    summary: 'Bonos a la venta del centro (no archivados), por orden de creación.',
  })
  @ApiOkResponse({ type: RateListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { rates: await this.listRates.execute(actor) };
  }

  @RequiresModule('passes')
  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'rates_create',
    summary:
      'Crea un bono: clases, días de validez, precio y los servicios en los que vale (vacío = todos).',
  })
  @ApiCreatedResponse({ type: RateResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CreateRateRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.createRate.execute(actor, body)) };
  }

  @RequiresModule('passes')
  @Patch(':rateId')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'rates_update',
    summary: 'Cambia un bono. Los ya vendidos conservan las condiciones con las que se pidieron.',
  })
  @ApiOkResponse({ type: RateResponseDto })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param() params: RateRouteParamsDto,
    @Body() body: UpdateRateRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.updateRate.execute(actor, params.rateId, body)) };
  }

  @RequiresModule('passes')
  @Delete(':rateId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'rates_archive',
    summary: 'Quita el bono de la venta (se archiva); los ya vendidos siguen valiendo.',
  })
  @ApiNoContentResponse()
  async archive(
    @CurrentActor() actor: ActorContext,
    @Param() params: RateRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.archiveRate.execute(actor, params.rateId);
  }

  @RequiresModule('passes')
  @Post(':rateId/request')
  @Roles('client')
  @ApiOperation({
    operationId: 'passes_request',
    summary:
      'La persona pide un bono: queda pendiente hasta que el centro lo active al cobrarlo. 409 si ya tiene ese bono pendiente.',
  })
  @ApiCreatedResponse({ type: PassResponseDto })
  async request(
    @CurrentActor() actor: ActorContext,
    @Param() params: RateRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializePass(await this.requestPass.execute(actor, params.rateId));
  }
}

@ApiTags('passes')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/passes')
export class PassesController {
  constructor(
    private readonly assignPass: AssignPassUseCase,
    private readonly listPasses: ListPassesUseCase,
    private readonly decidePass: DecidePassUseCase,
    private readonly listEligible: ListEligibleClientsUseCase,
    private readonly cancelPass: CancelPassUseCase,
  ) {}

  @Get('eligible')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'passes_eligible',
    summary:
      'Las personas a las que el centro puede apuntar a una clase de ese servicio: con un bono en vigor y clases por agendar.',
  })
  @ApiOkResponse({ type: EligibleClientsResponseDto })
  async eligible(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: EligibleClientsQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { clients: await this.listEligible.execute(actor, query.serviceId) };
  }

  @Get('mine')
  @Roles('client')
  @ApiOperation({
    operationId: 'passes_mine',
    summary: 'Los bonos de quien pregunta: pendientes, activos, agotados y caducados.',
  })
  @ApiOkResponse({ type: PassListResponseDto })
  async mine(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const passes = await this.listPasses.execute(actor, {
      clientMembershipId: actor.membershipId,
      statuses: null,
    });
    return { passes: passes.map(serializePass) };
  }

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'passes_list',
    summary:
      'Los bonos del centro (pendientes de activar, activos…), filtrables por estado y por persona.',
  })
  @ApiOkResponse({ type: PassListResponseDto })
  async listCenterPasses(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: PassListQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const passes = await this.listPasses.execute(actor, {
      clientMembershipId: query.clientMembershipId ?? null,
      statuses: query.status === undefined ? null : [query.status],
    });
    return { passes: passes.map(serializePass) };
  }

  @RequiresModule('passes')
  @Post('assign')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'passes_assign',
    summary:
      'El centro entrega un bono ya activo a una persona (cobrado en mostrador, por ejemplo).',
  })
  @ApiCreatedResponse({ type: PassResponseDto })
  async assign(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: AssignPassRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializePass(await this.assignPass.execute(actor, body));
  }

  @RequiresModule('passes')
  @Post(':passId/activate')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'passes_activate',
    summary: 'Activa un bono pendiente: empieza a contar su validez y se avisa a la persona.',
  })
  @ApiOkResponse({ type: PassResponseDto })
  async activate(
    @CurrentActor() actor: ActorContext,
    @Param() params: PassRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializePass(
      await this.decidePass.execute(actor, { passId: params.passId, decision: 'activate' }),
    );
  }

  @RequiresModule('passes')
  @Post(':passId/reject')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'passes_reject',
    summary: 'Rechaza un bono pendiente.',
  })
  @ApiOkResponse({ type: PassResponseDto })
  async reject(
    @CurrentActor() actor: ActorContext,
    @Param() params: PassRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializePass(
      await this.decidePass.execute(actor, { passId: params.passId, decision: 'reject' }),
    );
  }

  @RequiresModule('passes')
  @Delete(':passId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'passes_cancel',
    summary:
      'Quita un bono asignado (por error o dado de baja): deja de salir y de poder usarse. No se borra del libro. 404 si no existe o ya estaba quitado.',
  })
  @ApiNoContentResponse()
  async cancel(
    @CurrentActor() actor: ActorContext,
    @Param() params: PassRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.cancelPass.execute(actor, params.passId);
  }
}
