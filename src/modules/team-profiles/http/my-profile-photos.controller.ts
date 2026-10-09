import { Controller, Delete, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type FastifyRequest } from 'fastify';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { PHOTO_CONTENT_TYPES } from '../../photos/domain/photo-rules';
import { readPhotoBytes } from '../../photos/http/photo-request-body';
import { ProfilePresenter } from '../application/profile-presenter';
import { ManageMyPhotosUseCase, SaveMyProfileUseCase } from '../application/team-profile.use-cases';
import { CenterParamsDto, PhotoParamsDto, ProfileResponseDto } from './team-profile.dto';

/** La galería de fotos de mi perfil profesional (hasta 6). */
@ApiTags('team-profiles')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/team-profiles/me/photos')
export class MyProfilePhotosController {
  constructor(
    private readonly galleryPhotos: ManageMyPhotosUseCase,
    private readonly ownProfile: SaveMyProfileUseCase,
    private readonly presenter: ProfilePresenter,
  ) {}

  @Post()
  @Throttle({ default: RATE_LIMITS.uploadPhoto })
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'team_profiles_add_photo',
    summary:
      'Añade una foto al final de la galería de mi perfil (cuerpo JPEG, PNG o WebP, hasta 5 MB; máximo 6 fotos). El perfil vuelve a borrador. 400 PHOTO_NOT_IMAGE, 413 PHOTO_TOO_LARGE, 409 PROFILE_PHOTO_LIMIT_REACHED, 409 PHOTO_QUOTA_EXCEEDED (el centro llenó su espacio de fotos), 429 RATE_LIMITED.',
  })
  @ApiConsumes(...PHOTO_CONTENT_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: ProfileResponseDto })
  async addPhoto(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
    @Req() request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.galleryPhotos.add({ actor, bytes: readPhotoBytes(request) });
    return this.presenter.present(await this.ownProfile.readOwn(actor), actor);
  }

  @Delete(':photoId')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'team_profiles_remove_photo',
    summary: 'Quita una foto de la galería de mi perfil. El perfil vuelve a borrador.',
  })
  @ApiNoContentResponse()
  async removePhoto(
    @CurrentActor() actor: ActorContext,
    @Param() params: PhotoParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.galleryPhotos.remove(actor, params.photoId);
  }
}
