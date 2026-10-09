import { Body, Controller, Param, Put } from '@nestjs/common';
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
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { ContentPresenter } from '../application/content-presenter';
import { AssignContentUseCase } from '../application/content.use-cases';
import { AssignContentRequestDto, ContentResponseDto, ContentRouteParamsDto } from './content.dto';

/** A quién se enseña cada pieza de la biblioteca: lo decide la administración y también el equipo. */
@ApiTags('content')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/content')
export class ContentAssignmentsController {
  constructor(
    private readonly assignContent: AssignContentUseCase,
    private readonly presenter: ContentPresenter,
    private readonly push: PushDispatcher,
  ) {}

  @Put(':contentId/assignments')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'content_assign',
    summary:
      'Fija a quién se enseña la pieza (niveles, grupos o clientes); la lista sustituye a la anterior y se avisa por push solo a quien es nuevo. 422 CONTENT_ASSIGNMENT_INVALID si un grupo o cliente no existe.',
  })
  @ApiOkResponse({ type: ContentResponseDto })
  async assign(
    @CurrentActor() actor: ActorContext,
    @Param() params: ContentRouteParamsDto,
    @Body() body: AssignContentRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const content = await this.assignContent.execute(actor, {
      contentId: params.contentId,
      targets: body.targets,
    });
    await this.push.flushCenter(actor);
    return { ...this.presenter.present(content) };
  }
}
