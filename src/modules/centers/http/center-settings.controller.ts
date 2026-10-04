import { Body, Controller, Get, Headers, Param, Patch, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type FastifyReply } from 'fastify';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  GetCenterSettingsUseCase,
  UpdateCenterSettingsUseCase,
  type VersionedCenterSettings,
} from '../application/center-settings.use-cases';
import {
  CenterRouteParamsDto,
  CenterSettingsResponseDto,
  UpdateCenterSettingsRequestDto,
} from './center-settings.dto';

function serializeSettings({ settings }: VersionedCenterSettings): Record<string, unknown> {
  // `updatedAt` es la versión: viaja en el ETag, no en el cuerpo.
  const bodyFields = Object.entries(settings).filter(([field]) => field !== 'updatedAt');
  return {
    ...Object.fromEntries(bodyFields),
    trialEndsAt: settings.trialEndsAt?.toISOString() ?? null,
  };
}

/** Datos del centro para quien lo administra. La versión viaja en `ETag`; editar exige `If-Match`. */
@ApiTags('centers')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
@Roles('owner', 'admin')
export class CenterSettingsController {
  constructor(
    private readonly getSettings: GetCenterSettingsUseCase,
    private readonly updateSettings: UpdateCenterSettingsUseCase,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'centers_get_settings',
    summary: 'Datos, horario, festivos y política de cancelación del centro. Devuelve ETag.',
  })
  @ApiOkResponse({ type: CenterSettingsResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const versioned = await this.getSettings.execute(actor, params.centerId);
    void reply.header('etag', versioned.etag);
    return serializeSettings(versioned);
  }

  @Patch()
  @ApiHeader({ name: 'If-Match', required: true, description: 'El ETag que se leyó' })
  @ApiOperation({
    operationId: 'centers_update_settings',
    summary:
      'Modifica datos del centro. Exige If-Match: 428 si falta, 412 si otra persona lo cambió antes.',
  })
  @ApiOkResponse({ type: CenterSettingsResponseDto })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Body() body: UpdateCenterSettingsRequestDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const versioned = await this.updateSettings.execute({
      actor,
      routeCenterId: params.centerId,
      ifMatchHeader,
      patch: body,
    });
    void reply.header('etag', versioned.etag);
    return serializeSettings(versioned);
  }
}
