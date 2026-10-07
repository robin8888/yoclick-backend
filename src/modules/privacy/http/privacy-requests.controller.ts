import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { ActivityRecorder } from '../../activity/application/activity-recorder';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { type PrivacyRequestView } from '../application/ports/privacy-request.repository';
import {
  CreatePrivacyRequestUseCase,
  ListPrivacyRequestsUseCase,
  ResolvePrivacyRequestUseCase,
} from '../application/privacy-request.use-cases';
import {
  CenterParamsDto,
  CreatePrivacyRequestDto,
  PrivacyRequestListResponseDto,
  PrivacyRequestParamsDto,
  PrivacyRequestResponseDto,
  ResolvePrivacyRequestDto,
} from './privacy-request.dto';

function serializeRequest(request: PrivacyRequestView): Record<string, unknown> {
  return {
    ...request,
    dueAt: request.dueAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
  };
}

/** Solicitudes de derechos RGPD: la clientela las hace al centro (responsable) y la administración las responde. */
@ApiTags('privacy')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/privacy-requests')
export class PrivacyRequestsController {
  constructor(
    private readonly createRequest: CreatePrivacyRequestUseCase,
    private readonly listRequests: ListPrivacyRequestsUseCase,
    private readonly resolveRequest: ResolvePrivacyRequestUseCase,
    private readonly activity: ActivityRecorder,
    private readonly push: PushDispatcher,
  ) {}

  @Post()
  @Roles('client')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'privacy_create_request',
    summary:
      'Pide al centro acceso, rectificación, supresión u oposición. El centro tiene un mes para responder y la administración lo sabe por push. 409 PRIVACY_REQUEST_ALREADY_OPEN si ya hay una abierta del mismo derecho.',
  })
  @ApiCreatedResponse({ type: PrivacyRequestResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
    @Body() body: CreatePrivacyRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const request = await this.createRequest.execute({
      actor,
      kind: body.kind,
      message: body.message,
    });
    await this.push.flushCenter(actor);
    return serializeRequest(request);
  }

  @Get('mine')
  @Roles('client')
  @ApiOperation({
    operationId: 'privacy_list_my_requests',
    summary: 'Mis solicitudes al centro, de la más reciente a la más antigua.',
  })
  @ApiOkResponse({ type: PrivacyRequestListResponseDto })
  async listMine(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const requests = await this.listRequests.execute(actor, 'mine');
    return { requests: requests.map(serializeRequest) };
  }

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'privacy_list_requests',
    summary:
      'Las solicitudes de la clientela: primero las abiertas (la que vence antes, arriba) y luego las resueltas.',
  })
  @ApiOkResponse({ type: PrivacyRequestListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const requests = await this.listRequests.execute(actor, 'center');
    return { requests: requests.map(serializeRequest) };
  }

  @Post(':requestId/resolve')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'privacy_resolve_request',
    summary:
      'Marca la solicitud como atendida o rechazada (al rechazar hay que decir por qué) y la persona lo sabe por push. 409 PRIVACY_REQUEST_CLOSED si ya estaba resuelta.',
  })
  @ApiOkResponse({ type: PrivacyRequestResponseDto })
  async resolve(
    @CurrentActor() actor: ActorContext,
    @Param() params: PrivacyRequestParamsDto,
    @Body() body: ResolvePrivacyRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const request = await this.resolveRequest.execute({
      actor,
      requestId: params.requestId,
      outcome: body.outcome,
      note: body.note,
    });
    await this.activity.record(actor, {
      kind: 'privacy_request_resolved',
      subject: request.clientName,
    });
    await this.push.flushCenter(actor);
    return serializeRequest(request);
  }
}
