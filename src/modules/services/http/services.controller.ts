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
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type ServiceView } from '../application/ports/service.repository';
import {
  ArchiveServiceUseCase,
  CreateServiceUseCase,
  ListServicesUseCase,
  UpdateServiceUseCase,
} from '../application/service.use-cases';
import {
  CenterRouteParamsDto,
  CreateServiceRequestDto,
  ServiceListResponseDto,
  ServiceResponseDto,
  ServiceRouteParamsDto,
  UpdateServiceRequestDto,
} from './service.dto';

function serializeService(service: ServiceView): Record<string, unknown> {
  return { ...service, currency: 'EUR' };
}

@ApiTags('services')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/services')
export class ServicesController {
  constructor(
    private readonly listServices: ListServicesUseCase,
    private readonly createService: CreateServiceUseCase,
    private readonly updateService: UpdateServiceUseCase,
    private readonly archiveService: ArchiveServiceUseCase,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'services_list',
    summary:
      'Servicios del centro. La clientela solo ve los visibles; el equipo ve todos los no archivados.',
  })
  @ApiOkResponse({ type: ServiceListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { services: (await this.listServices.execute(actor)).map(serializeService) };
  }

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'services_create',
    summary:
      'Crea un servicio individual. Si no se indica quién lo atiende, lo atiende quien lo crea.',
  })
  @ApiCreatedResponse({ type: ServiceResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CreateServiceRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const service = await this.createService.execute({
      actor,
      service: {
        name: body.name,
        description: body.description ?? null,
        durationMinutes: body.durationMinutes,
        priceCents: body.priceCents ?? null,
        color: body.color ?? null,
        bookingWindowDays: body.bookingWindowDays,
        minNoticeMinutes: body.minNoticeMinutes,
        isVisible: body.isVisible,
        roomId: body.roomId ?? null,
        staffMembershipIds: body.staffMembershipIds,
      },
    });
    return serializeService(service);
  }

  @Patch(':serviceId')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'services_update',
    summary:
      'Modifica un servicio. Solo cambia lo que se envía; null borra descripción, precio o color.',
  })
  @ApiOkResponse({ type: ServiceResponseDto })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param() params: ServiceRouteParamsDto,
    @Body() body: UpdateServiceRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializeService(await this.updateService.execute(actor, params.serviceId, body));
  }

  @Delete(':serviceId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'services_archive',
    summary: 'Archiva el servicio: deja de ofrecerse, pero las reservas existentes se conservan.',
  })
  @ApiNoContentResponse()
  async archive(
    @CurrentActor() actor: ActorContext,
    @Param() params: ServiceRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.archiveService.execute(actor, params.serviceId);
  }
}
