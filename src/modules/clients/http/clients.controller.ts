import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
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
import {
  GetClientUseCase,
  ListClientsUseCase,
  UpdateClientUseCase,
} from '../application/client.use-cases';
import { type ClientView } from '../application/ports/client.repository';
import {
  CenterRouteParamsDto,
  ClientListQueryDto,
  ClientListResponseDto,
  ClientResponseDto,
  ClientRouteParamsDto,
  UpdateClientRequestDto,
} from './client.dto';

function serializeClient(client: ClientView): Record<string, unknown> {
  return {
    ...client,
    joinedAt: client.joinedAt.toISOString(),
    lastBookingAt: client.lastBookingAt?.toISOString() ?? null,
    nextBookingAt: client.nextBookingAt?.toISOString() ?? null,
  };
}

@ApiTags('clients')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/clients')
export class ClientsController {
  constructor(
    private readonly listClients: ListClientsUseCase,
    private readonly getClient: GetClientUseCase,
    private readonly updateClient: UpdateClientUseCase,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'clients_list',
    summary:
      'Clientes del centro por nombre (la profesional ve solo a quienes han reservado con ella), con búsqueda por nombre o correo y filtro por estado (activos, nuevos, inactivos o bloqueados). Con paginación por limit y offset.',
  })
  @ApiOkResponse({ type: ClientListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: ClientListQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const result = await this.listClients.execute(actor, {
      search: query.search === undefined || query.search === '' ? null : query.search,
      status: query.status ?? null,
      groupId: query.groupId ?? null,
      limit: query.limit,
      offset: query.offset,
    });
    return { ...result, clients: result.clients.map(serializeClient) };
  }

  @Get(':membershipId')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'clients_get',
    summary: 'Un cliente del centro con su nivel, su grupo y cómo va. 404 si no existe.',
  })
  @ApiOkResponse({ type: ClientResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: ClientRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializeClient(await this.getClient.execute(actor, params.membershipId));
  }

  @Patch(':membershipId')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'clients_update',
    summary: 'Cambia el nivel de un cliente o su grupo; null quita el nivel o lo saca del grupo.',
  })
  @ApiOkResponse({ type: ClientResponseDto })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param() params: ClientRouteParamsDto,
    @Body() body: UpdateClientRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializeClient(await this.updateClient.execute(actor, params.membershipId, body));
  }
}
