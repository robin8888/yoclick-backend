import { RequiresModule } from '../../../shared/auth/decorators/requires-module.decorator';
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
import { RequiresPlanFeature } from '../../../shared/auth/decorators/requires-plan-feature.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { ContentPresenter } from '../application/content-presenter';
import { GetMyContentUseCase, ListMyContentUseCase } from '../application/content.use-cases';
import {
  CenterRouteParamsDto,
  ContentDetailResponseDto,
  ContentRouteParamsDto,
  MyContentListResponseDto,
} from './content.dto';

/** Lo que el centro le ha asignado al cliente (por su nivel, su grupo o a él): vídeos y PDF. */
@ApiTags('content')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@RequiresModule('content')
@RequiresPlanFeature('contentLibrary')
@Controller('centers/:centerId/my-content')
export class MyContentController {
  constructor(
    private readonly listMyContent: ListMyContentUseCase,
    private readonly getMyContent: GetMyContentUseCase,
    private readonly presenter: ContentPresenter,
  ) {}

  @Get()
  @Roles('client')
  @ApiOperation({
    operationId: 'content_list_mine',
    summary:
      'Los vídeos y PDF asignados a quien pregunta; los vídeos solo cuando ya se pueden ver.',
  })
  @ApiOkResponse({ type: MyContentListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const items = await this.listMyContent.execute(actor);
    return { items: items.map((item) => this.presenter.present(item)) };
  }

  @Get(':contentId')
  @Roles('client')
  @ApiOperation({
    operationId: 'content_get_mine',
    summary:
      'Una pieza asignada, con el enlace firmado para reproducir el vídeo o leer el PDF. 404 si no es suya.',
  })
  @ApiOkResponse({ type: ContentDetailResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: ContentRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const content = await this.getMyContent.execute(actor, params.contentId);
    return { ...this.presenter.presentDetail(content) };
  }
}
