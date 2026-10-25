import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { CurrentPlatformActor } from '../../../shared/auth/decorators/current-platform-actor.decorator';
import { PlatformRoles } from '../../../shared/auth/decorators/platform-roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import {
  GetPlatformCenterUseCase,
  GetPlatformOverviewUseCase,
  ListPlatformAuditUseCase,
  ListPlatformCentersUseCase,
  UpdatePlatformCenterUseCase,
} from '../application/platform.use-cases';
import {
  type PlatformAuditEntry,
  type PlatformCenterDetail,
  type PlatformCenterSummary,
} from '../application/ports/platform.repository';
import {
  PlatformAuditListResponseDto,
  PlatformAuditQueryDto,
  PlatformCenterDetailResponseDto,
  PlatformCenterListResponseDto,
  PlatformCenterRouteParamsDto,
  PlatformCentersQueryDto,
  PlatformOverviewResponseDto,
  UpdatePlatformCenterRequestDto,
} from './platform.dto';

function serializeCenter(center: PlatformCenterSummary): Record<string, unknown> {
  return {
    ...center,
    createdAt: center.createdAt.toISOString(),
    trialEndsAt: center.trialEndsAt?.toISOString() ?? null,
    lastBookingAt: center.lastBookingAt?.toISOString() ?? null,
  };
}

function serializeAuditEntry(entry: PlatformAuditEntry): Record<string, unknown> {
  return { ...entry, createdAt: entry.createdAt.toISOString() };
}

/**
 * Administración de la plataforma (docs/spec/17). Solo para el usuario `admin` de plataforma, con segundo
 * factor. Devuelve cifras agregadas de los centros: nunca datos de las personas que usan cada centro.
 */
@ApiTags('platform')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('platform')
@PlatformRoles('admin')
@Throttle({ default: RATE_LIMITS.platformAdmin })
export class PlatformController {
  constructor(
    private readonly getOverview: GetPlatformOverviewUseCase,
    private readonly listCenters: ListPlatformCentersUseCase,
    private readonly getCenter: GetPlatformCenterUseCase,
    private readonly updateCenter: UpdatePlatformCenterUseCase,
    private readonly listAudit: ListPlatformAuditUseCase,
  ) {}

  @Get('overview')
  @ApiOperation({
    operationId: 'platform_get_overview',
    summary:
      'Cifras de toda la plataforma: centros por estado, altas, pruebas que acaban, clientes y reservas agregados y evolución de 12 meses.',
  })
  @ApiOkResponse({ type: PlatformOverviewResponseDto })
  async overview(@CurrentPlatformActor() actor: PlatformActorContext): Promise<unknown> {
    const overview = await this.getOverview.execute(actor);
    return { ...overview, generatedAt: overview.generatedAt.toISOString() };
  }

  @Get('centers')
  @ApiOperation({
    operationId: 'platform_list_centers',
    summary:
      'Centros con su plan, estado y cifras de uso (clientes activos, equipo, reservas de 30 días). Filtros por estado, sector y nombre.',
  })
  @ApiOkResponse({ type: PlatformCenterListResponseDto })
  async centers(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Query() query: PlatformCentersQueryDto,
  ): Promise<unknown> {
    const page = await this.listCenters.execute(actor, query);
    return { data: page.data.map(serializeCenter), nextCursor: page.nextCursor };
  }

  @Get('centers/:centerId')
  @ApiOperation({
    operationId: 'platform_get_center',
    summary: 'Un centro con sus límites, módulos y cifras de uso.',
  })
  @ApiOkResponse({ type: PlatformCenterDetailResponseDto })
  async center(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Param() params: PlatformCenterRouteParamsDto,
  ): Promise<unknown> {
    return serializeCenter(await this.getCenter.execute(actor, params.centerId));
  }

  @Patch('centers/:centerId')
  @ApiOperation({
    operationId: 'platform_update_center',
    summary:
      'Cambia el estado, el fin de la prueba (siempre en el futuro) o el tope de clientes de un centro. Cada cambio queda en el registro de auditoría.',
  })
  @ApiOkResponse({ type: PlatformCenterDetailResponseDto })
  async update(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Param() params: PlatformCenterRouteParamsDto,
    @Body() body: UpdatePlatformCenterRequestDto,
  ): Promise<unknown> {
    const detail: PlatformCenterDetail = await this.updateCenter.execute(actor, params.centerId, {
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(body.planId === undefined ? {} : { planId: body.planId }),
      ...(body.trialEndsAt === undefined
        ? {}
        : { trialEndsAt: body.trialEndsAt === null ? null : new Date(body.trialEndsAt) }),
      ...(body.maxClients === undefined ? {} : { maxClients: body.maxClients }),
    });
    return serializeCenter(detail);
  }

  @Get('audit-log')
  @ApiOperation({
    operationId: 'platform_list_audit_log',
    summary:
      'Registro de lo que se ha hecho desde la administración de la plataforma, lo último primero.',
  })
  @ApiOkResponse({ type: PlatformAuditListResponseDto })
  async auditLog(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Query() query: PlatformAuditQueryDto,
  ): Promise<unknown> {
    const page = await this.listAudit.execute(actor, query);
    return { data: page.data.map(serializeAuditEntry), nextCursor: page.nextCursor };
  }
}
