import { Controller, Delete, HttpCode, HttpStatus, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { RemoveMemberPhotoUseCase } from '../application/photo.use-cases';
import { MemberPhotoRouteParamsDto } from './photo.dto';

@ApiTags('team')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/members/:membershipId/photo')
export class MemberPhotoController {
  constructor(private readonly removePhoto: RemoveMemberPhotoUseCase) {}

  @Delete()
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'members_remove_photo',
    summary:
      'Moderación: quita la foto de perfil de una persona del centro (cliente o equipo). 404 si no es del centro.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentActor() actor: ActorContext,
    @Param() params: MemberPhotoRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.removePhoto.execute(actor, params.membershipId);
  }
}
