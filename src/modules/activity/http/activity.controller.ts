import { Controller, Get, Param, Query } from '@nestjs/common';
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
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { ListActivityUseCase } from '../application/list-activity.use-case';
import { ActivityQueryDto, ActivityResponseDto, ActivityRouteParamsDto } from './activity.dto';

/** Registro de actividad de la pantalla de seguridad: quién hizo qué en el centro. */
@ApiTags('activity')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/activity')
@Roles('owner', 'admin')
export class ActivityController {
  constructor(private readonly listActivity: ListActivityUseCase) {}

  @Get()
  @ApiOperation({
    operationId: 'activity_list',
    summary: 'Lo último que ha pasado en el centro (quién cambió qué), lo más reciente primero.',
  })
  @ApiOkResponse({ type: ActivityResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: ActivityRouteParamsDto,
    @Query() query: ActivityQueryDto,
  ): Promise<Record<string, unknown>> {
    if (params.centerId !== actor.centerId) {
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
    const entries = await this.listActivity.execute(actor, query.limit);
    return {
      entries: entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    };
  }
}
