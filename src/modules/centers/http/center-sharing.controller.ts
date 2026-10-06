import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import {
  GetJoinStatsUseCase,
  RegenerateJoinCodeUseCase,
} from '../application/center-sharing.use-cases';
import { CenterRouteParamsDto } from './center-settings.dto';
import { JoinCodeResponseDto, JoinStatsResponseDto } from './center-sharing.dto';
import { ActivityRecorder } from '../../activity/application/activity-recorder';

/** Un centro ajeno y uno inexistente son lo mismo para quien pregunta: 404. */
function assertRouteTargetsActorCenter(actor: ActorContext, routeCenterId: string): void {
  if (routeCenterId !== actor.centerId) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
}

/** «Invita a tus clientes»: cuántos se unen y por dónde, y el cambio del código del centro. */
@ApiTags('centers')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
@Roles('owner', 'admin')
export class CenterSharingController {
  constructor(
    private readonly getJoinStats: GetJoinStatsUseCase,
    private readonly regenerateJoinCode: RegenerateJoinCodeUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Get('join-stats')
  @ApiOperation({
    operationId: 'centers_get_join_stats',
    summary:
      'Cuántos clientes se han unido este mes (en la zona horaria del centro), por QR, enlace, código o buscador.',
  })
  @ApiOkResponse({ type: JoinStatsResponseDto })
  async stats(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.getJoinStats.execute(actor)) };
  }

  @Post('join-code/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'centers_regenerate_join_code',
    summary:
      'Cambia el código de unión del centro. El QR y el enlace anteriores dejan de funcionar; quien ya se unió no se ve afectado.',
  })
  @ApiOkResponse({ type: JoinCodeResponseDto })
  async regenerate(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const joinCode = await this.regenerateJoinCode.execute(actor);
    await this.activity.record(actor, { kind: 'join_code_regenerated' });
    return { joinCode };
  }
}
