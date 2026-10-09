import { Controller, Delete, HttpCode, HttpStatus, Put, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type FastifyRequest } from 'fastify';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { RemoveMyPhotoUseCase, SetMyPhotoUseCase } from '../application/photo.use-cases';
import { PHOTO_CONTENT_TYPES } from '../domain/photo-rules';
import { MyPhotoResponseDto } from './photo.dto';
import { readPhotoBytes } from './photo-request-body';

/** La foto de perfil de la persona: una, la misma en todos sus centros. No lleva `X-Center-Id`. */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('me/photo')
@UserScoped()
export class MyPhotoController {
  constructor(
    private readonly setPhoto: SetMyPhotoUseCase,
    private readonly removePhoto: RemoveMyPhotoUseCase,
  ) {}

  @Put()
  @Throttle({ default: RATE_LIMITS.uploadPhoto })
  @ApiOperation({
    operationId: 'me_set_photo',
    summary:
      'Cambia mi foto de perfil (cuerpo JPEG, PNG o WebP, hasta 5 MB; se reconoce por su contenido, no por el tipo). Sustituye a la anterior. 400 PHOTO_NOT_IMAGE, 413 PHOTO_TOO_LARGE, 429 RATE_LIMITED.',
  })
  @ApiConsumes(...PHOTO_CONTENT_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: MyPhotoResponseDto })
  async set(
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const photoUrl = await this.setPhoto.execute({ userId, bytes: readPhotoBytes(request) });
    return { photoUrl };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'me_remove_photo', summary: 'Quita mi foto de perfil.' })
  @ApiNoContentResponse()
  async remove(@CurrentUserId() userId: string): Promise<void> {
    await this.removePhoto.execute(userId);
  }
}
