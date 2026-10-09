import { Body, Controller, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { ContentPresenter } from '../application/content-presenter';
import {
  AddDocumentUseCase,
  AddImageUseCase,
  AddVideoContentUseCase,
} from '../application/content.use-cases';
import { PHOTO_CONTENT_TYPES } from '../../photos/domain/photo-rules';
import { readPhotoBytes } from '../../photos/http/photo-request-body';
import { PDF_CONTENT_TYPE } from '../domain/content-rules';
import {
  AddDocumentQueryDto,
  AddVideoContentRequestDto,
  CenterRouteParamsDto,
  ContentResponseDto,
} from './content.dto';

/** Añadir piezas a la biblioteca: un PDF o una imagen (el cuerpo es el fichero) o un vídeo ya subido. */
@ApiTags('content')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/content')
export class ContentUploadsController {
  constructor(
    private readonly addDocument: AddDocumentUseCase,
    private readonly addImage: AddImageUseCase,
    private readonly addVideo: AddVideoContentUseCase,
    private readonly presenter: ContentPresenter,
  ) {}

  @Post('documents')
  @Throttle({ default: RATE_LIMITS.uploadDocument })
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'content_add_document',
    summary:
      'Sube un PDF (cuerpo `application/pdf`, hasta 50 MB) y lo añade a la biblioteca. 400 DOCUMENT_NOT_PDF, 413 DOCUMENT_TOO_LARGE, 409 DOCUMENT_QUOTA_EXCEEDED, 429 RATE_LIMITED.',
  })
  @ApiConsumes(PDF_CONTENT_TYPE)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: ContentResponseDto })
  async uploadDocument(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Req() request: FastifyRequest,
    @Query() query: AddDocumentQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    if (!Buffer.isBuffer(request.body)) {
      throw new DomainError('DOCUMENT_NOT_PDF', HTTP_STATUS.badRequest);
    }
    const content = await this.addDocument.execute({
      actor,
      bytes: request.body,
      title: query.title,
      need: query.need ?? null,
      level: query.level ?? null,
    });
    return { ...this.presenter.present(content) };
  }

  @Post('images')
  @Throttle({ default: RATE_LIMITS.uploadPhoto })
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'content_add_image',
    summary:
      'Sube una imagen (cuerpo JPEG, PNG o WebP, hasta 5 MB; se reconoce por su contenido, no por el tipo) y la añade a la biblioteca. Cuenta en el mismo espacio que los PDF. 400 PHOTO_NOT_IMAGE, 413 PHOTO_TOO_LARGE, 409 DOCUMENT_QUOTA_EXCEEDED, 429 RATE_LIMITED.',
  })
  @ApiConsumes(...PHOTO_CONTENT_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: ContentResponseDto })
  async uploadImage(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Req() request: FastifyRequest,
    @Query() query: AddDocumentQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const content = await this.addImage.execute({
      actor,
      bytes: readPhotoBytes(request),
      title: query.title,
      need: query.need ?? null,
      level: query.level ?? null,
    });
    return { ...this.presenter.present(content) };
  }

  @Post('videos')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'content_add_video',
    summary:
      'Añade a la biblioteca un vídeo ya reservado con `videos_start_upload`. 409 CONTENT_VIDEO_ALREADY_IN_LIBRARY si ya está.',
  })
  @ApiCreatedResponse({ type: ContentResponseDto })
  async uploadVideo(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: AddVideoContentRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const content = await this.addVideo.execute({
      actor,
      videoId: body.videoId,
      title: body.title,
      need: body.need ?? null,
      level: body.level ?? null,
    });
    return { ...this.presenter.present(content) };
  }
}
