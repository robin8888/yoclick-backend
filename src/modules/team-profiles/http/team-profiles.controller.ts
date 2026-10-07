import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
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
import { ProfilePresenter } from '../application/profile-presenter';
import {
  GetTeamProfileUseCase,
  ListTeamProfilesUseCase,
  ManageMyCertificationsUseCase,
  SaveMyProfileUseCase,
  SubmitMyProfileUseCase,
} from '../application/team-profile.use-cases';
import {
  AddCertificationRequestDto,
  CenterParamsDto,
  CertificationParamsDto,
  MemberParamsDto,
  ProfileListResponseDto,
  ProfileResponseDto,
  SaveProfileRequestDto,
} from './team-profile.dto';

/** Lo que se ve del equipo: la clientela solo los perfiles publicados; el equipo, también el suyo. */
@ApiTags('team-profiles')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/team-profiles')
export class TeamProfilesController {
  constructor(
    private readonly listProfiles: ListTeamProfilesUseCase,
    private readonly getProfile: GetTeamProfileUseCase,
    private readonly presenter: ProfilePresenter,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'team_profiles_list',
    summary:
      'El equipo con su perfil. La clientela solo ve los publicados; el equipo, los publicados y el suyo; la administración, todos.',
  })
  @ApiOkResponse({ type: ProfileListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const profiles = await this.listProfiles.execute(actor);
    return { members: profiles.map((profile) => this.presenter.present(profile, actor)) };
  }

  @Get(':membershipId')
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'team_profiles_get',
    summary: 'El perfil de una persona del equipo. 404 si no existe o todavía no está publicado.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: MemberParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return this.presenter.present(await this.getProfile.execute(actor, params.membershipId), actor);
  }
}

/** Mi perfil profesional: lo escribo yo y el centro lo revisa antes de que lo vea la clientela. */
@ApiTags('team-profiles')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/team-profiles/me')
export class MyProfileController {
  constructor(
    private readonly saveProfile: SaveMyProfileUseCase,
    private readonly submitProfile: SubmitMyProfileUseCase,
    private readonly certifications: ManageMyCertificationsUseCase,
    private readonly presenter: ProfilePresenter,
    private readonly push: PushDispatcher,
  ) {}

  @Put()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'team_profiles_save_mine',
    summary:
      'Guarda mi titular, biografía, especialidades, idiomas y la autorización para publicar mi imagen. El perfil vuelve a borrador.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  async save(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
    @Body() body: SaveProfileRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const profile = await this.saveProfile.execute({
      actor,
      headline: body.headline,
      bio: body.bio,
      specialties: body.specialties,
      languages: body.languages,
      hasPublishConsent: body.hasPublishConsent,
    });
    return this.presenter.present(profile, actor);
  }

  @Post('submit')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'team_profiles_submit_mine',
    summary:
      'Envía mi perfil: el equipo espera la revisión del centro (que lo sabe por push) y la administración lo publica directamente. 409 PROFILE_CONSENT_REQUIRED sin autorización de publicar; 409 PROFILE_EMPTY si no hay nada que enseñar.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  async submit(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const profile = await this.submitProfile.execute(actor);
    await this.push.flushCenter(actor);
    return this.presenter.present(profile, actor);
  }

  @Post('certifications')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'team_profiles_add_certification',
    summary:
      'Añade una titulación a mi perfil (el centro la verifica después). El perfil vuelve a borrador.',
  })
  @ApiCreatedResponse({ type: ProfileResponseDto })
  async addCertification(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
    @Body() body: AddCertificationRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.certifications.add({ actor, name: body.name, detail: body.detail });
    return this.presenter.present(await this.saveProfile.readOwn(actor), actor);
  }

  @Delete('certifications/:certificationId')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'team_profiles_remove_certification',
    summary: 'Quita una titulación de mi perfil.',
  })
  @ApiNoContentResponse()
  async removeCertification(
    @CurrentActor() actor: ActorContext,
    @Param() params: CertificationParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.certifications.remove(actor, params.certificationId);
  }
}
