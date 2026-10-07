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
import { GetVideoPlanUseCase } from '../application/video.use-cases';
import { CenterRouteParamsDto, VideoPlanResponseDto } from './video.dto';

/** Si el plan del centro incluye vídeo y cuánto espacio queda: lo necesita todo el equipo para mostrar o no los botones. */
@ApiTags('videos')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/video-plan')
export class VideoPlanController {
  constructor(private readonly getPlan: GetVideoPlanUseCase) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'videos_get_plan',
    summary: 'Si el plan del centro incluye vídeo, el espacio contratado y el usado.',
  })
  @ApiOkResponse({ type: VideoPlanResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const facts = await this.getPlan.execute(actor);
    const limit = facts.storageLimitBytes;
    return {
      isIncluded: limit !== null,
      limitBytes: limit === null ? null : Number(limit),
      usedBytes: Number(facts.usedBytes),
    };
  }
}
