import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { VideoPresenter } from '../application/video-presenter';
import {
  DeleteVideoUseCase,
  GetVideoUseCase,
  StartVideoUploadUseCase,
} from '../application/video.use-cases';
import {
  CenterRouteParamsDto,
  StartVideoUploadRequestDto,
  StartVideoUploadResponseDto,
  VideoResponseDto,
  VideoRouteParamsDto,
} from './video.dto';

/** Vídeos del centro (plan Premium): subida directa a Bunny, estado y borrado. */
@ApiTags('videos')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class VideoUploadsController {
  constructor(
    private readonly startUpload: StartVideoUploadUseCase,
    private readonly getVideo: GetVideoUseCase,
    private readonly deleteVideo: DeleteVideoUseCase,
    private readonly presenter: VideoPresenter,
    private readonly push: PushDispatcher,
  ) {}

  @Post('videos')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'videos_start_upload',
    summary:
      'Reserva un vídeo y devuelve la firma para subirlo directamente al servicio de vídeo. 403 VIDEO_NOT_INCLUDED si el plan no incluye vídeo; 409 VIDEO_QUOTA_EXCEEDED si no cabe.',
  })
  @ApiCreatedResponse({ type: StartVideoUploadResponseDto })
  async start(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: StartVideoUploadRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const { video, upload } = await this.startUpload.execute({
      actor,
      title: body.title,
      sizeBytes: body.sizeBytes,
      purpose: body.purpose,
    });
    return {
      video: this.presenter.present(video, { isClient: false }),
      upload: {
        ...upload,
        headers: { ...upload.headers },
        expiresAt: upload.expiresAt.toISOString(),
      },
    };
  }

  @Get('videos/:videoId')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'videos_get',
    summary: 'El estado de un vídeo; mientras se sube o se procesa, consulta al servicio de vídeo.',
  })
  @ApiOkResponse({ type: VideoResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: VideoRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const video = await this.getVideo.execute(actor, params.videoId);
    await this.push.flushCenter(actor);
    return { ...this.presenter.present(video, { isClient: false }) };
  }

  @Delete('videos/:videoId')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'videos_delete',
    summary: 'Borra un vídeo (el del equipo, solo quien lo subió; la administración, cualquiera).',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentActor() actor: ActorContext,
    @Param() params: VideoRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.deleteVideo.execute(actor, params.videoId);
  }
}
