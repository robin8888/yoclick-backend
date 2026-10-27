import { RequiresModule } from '../../../shared/auth/decorators/requires-module.decorator';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiNoContentResponse,
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
import {
  ListContentUseCase,
  RemoveContentUseCase,
  UpdateContentUseCase,
} from '../application/content.use-cases';
import {
  CenterRouteParamsDto,
  ContentLibraryResponseDto,
  ContentResponseDto,
  ContentRouteParamsDto,
  UpdateContentRequestDto,
} from './content.dto';

/** La biblioteca del centro (vídeos y PDF) que gestiona la administración. */
@ApiTags('content')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@RequiresModule('content')
@RequiresPlanFeature('contentLibrary')
@Controller('centers/:centerId/content')
export class ContentLibraryController {
  constructor(
    private readonly listContent: ListContentUseCase,
    private readonly updateContent: UpdateContentUseCase,
    private readonly removeContent: RemoveContentUseCase,
    private readonly presenter: ContentPresenter,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'content_list',
    summary:
      'La biblioteca del centro, con a quién se enseña cada pieza y el espacio de PDF usado.',
  })
  @ApiOkResponse({ type: ContentLibraryResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const { items, storage } = await this.listContent.execute(actor);
    return {
      items: items.map((item) => this.presenter.present(item)),
      storage: {
        limitBytes: Number(storage.storageLimitBytes),
        usedBytes: Number(storage.usedBytes),
      },
    };
  }

  @Patch(':contentId')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'content_update',
    summary: 'Cambia el título, la necesidad o el nivel de una pieza.',
  })
  @ApiOkResponse({ type: ContentResponseDto })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param() params: ContentRouteParamsDto,
    @Body() body: UpdateContentRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const content = await this.updateContent.execute(actor, {
      contentId: params.contentId,
      changes: body,
    });
    return { ...this.presenter.present(content) };
  }

  @Delete(':contentId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'content_delete',
    summary: 'Borra una pieza y libera su espacio (el vídeo se borra si no lo usa una rutina).',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentActor() actor: ActorContext,
    @Param() params: ContentRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.removeContent.execute(actor, params.contentId);
  }
}
