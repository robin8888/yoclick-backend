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
import { RequiresPlanFeature } from '../../../shared/auth/decorators/requires-plan-feature.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { PhotoUrlSigner } from '../../photos/application/photo-url-signer';
import {
  LinkGuardianUseCase,
  ListGuardiansUseCase,
  ListMyChildrenUseCase,
  UnlinkGuardianUseCase,
} from '../application/guardian.use-cases';
import {
  CenterRouteParamsDto,
  ChildRouteParamsDto,
  GuardianListResponseDto,
  GuardianRouteParamsDto,
  LinkGuardianRequestDto,
  MyChildrenResponseDto,
} from './guardian.dto';

/** Los tutores de una persona: los gestiona la administración del centro, que comprueba el parentesco. */
@ApiTags('guardians')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@RequiresPlanFeature('families')
@Controller('centers/:centerId/clients/:childMembershipId/guardians')
export class ClientGuardiansController {
  constructor(
    private readonly listGuardians: ListGuardiansUseCase,
    private readonly linkGuardian: LinkGuardianUseCase,
    private readonly unlinkGuardian: UnlinkGuardianUseCase,
  ) {}

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'guardians_list',
    summary: 'Los tutores enlazados a una persona del centro.',
  })
  @ApiOkResponse({ type: GuardianListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: ChildRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { guardians: await this.listGuardians.execute(actor, params.childMembershipId) };
  }

  @Post()
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'guardians_link',
    summary:
      'Enlaza a un tutor con su hijo. 404 si alguno no existe; 409 GUARDIAN_MUST_BE_ADULT, GUARDIAN_INVALID_PEOPLE o GUARDIAN_ALREADY_LINKED.',
  })
  @ApiCreatedResponse({ description: 'Enlazado' })
  async link(
    @CurrentActor() actor: ActorContext,
    @Param() params: ChildRouteParamsDto,
    @Body() body: LinkGuardianRequestDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.linkGuardian.execute(actor, {
      guardianMembershipId: body.guardianMembershipId,
      childMembershipId: params.childMembershipId,
    });
  }

  @Delete(':guardianMembershipId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'guardians_unlink',
    summary: 'Quita el enlace de un tutor con su hijo.',
  })
  @ApiNoContentResponse()
  async unlink(
    @CurrentActor() actor: ActorContext,
    @Param() params: GuardianRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.unlinkGuardian.execute(actor, {
      guardianMembershipId: params.guardianMembershipId,
      childMembershipId: params.childMembershipId,
    });
  }
}

/** «Mis hijos»: lo que ve un tutor de las personas a su cargo. */
@ApiTags('guardians')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/guardians/me/children')
export class MyChildrenController {
  constructor(
    private readonly listChildren: ListMyChildrenUseCase,
    private readonly urlSigner: PhotoUrlSigner,
  ) {}

  @Get()
  @Roles('client')
  @ApiOperation({
    operationId: 'guardians_list_my_children',
    summary:
      'Las personas a cargo de quien pregunta, con sus próximas citas y las clases que les quedan.',
  })
  @ApiOkResponse({ type: MyChildrenResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const children = await this.listChildren.execute(actor);
    return {
      children: children.map((child) => ({
        membershipId: child.membershipId,
        fullName: child.fullName,
        photoUrl: this.urlSigner.sign(child.photoKey),
        isMinor: child.isMinor,
        upcomingBookings: child.upcomingBookings.map((booking) => ({
          ...booking,
          startsAt: booking.startsAt.toISOString(),
        })),
        remainingSessions: child.remainingSessions,
      })),
    };
  }
}
