import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
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
import { ProfilePresenter } from '../application/profile-presenter';
import {
  GetTeamProfileUseCase,
  ModerateTeamProfileUseCase,
  TeamSettingsUseCase,
} from '../application/team-profile.use-cases';
import {
  CenterParamsDto,
  MemberCertificationParamsDto,
  MemberParamsDto,
  ProfileResponseDto,
  ReviewProfileRequestDto,
  TeamSettingsRequestDto,
  TeamSettingsResponseDto,
} from './team-profile.dto';

/** La administración revisa los perfiles del equipo y comprueba sus titulaciones. */
@ApiTags('team-profiles')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/team-profiles/:membershipId')
export class ProfileModerationController {
  constructor(
    private readonly moderation: ModerateTeamProfileUseCase,
    private readonly getProfile: GetTeamProfileUseCase,
    private readonly presenter: ProfilePresenter,
    private readonly push: PushDispatcher,
  ) {}

  @Post('review')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'team_profiles_review',
    summary:
      'Aprueba y publica un perfil pendiente, o pide cambios (con una nota); la persona lo sabe por push. 409 PROFILE_NOT_REVIEWABLE si no estaba pendiente.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  async review(
    @CurrentActor() actor: ActorContext,
    @Param() params: MemberParamsDto,
    @Body() body: ReviewProfileRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.moderation.review({
      actor,
      membershipId: params.membershipId,
      isApproved: body.decision === 'approve',
      note: body.note,
    });
    await this.push.flushCenter(actor);
    return this.presenter.present(await this.getProfile.execute(actor, params.membershipId), actor);
  }

  @Post('certifications/:certificationId/verify')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'team_profiles_verify_certification',
    summary: 'Marca una titulación como comprobada por el centro.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  async verifyCertification(
    @CurrentActor() actor: ActorContext,
    @Param() params: MemberCertificationParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.moderation.verifyCertification(actor, params.certificationId);
    return this.presenter.present(await this.getProfile.execute(actor, params.membershipId), actor);
  }
}

/** Dos interruptores del centro: enseñar el equipo en la web de reservas y revisar las opiniones antes de publicarlas. */
@ApiTags('team-profiles')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/team-settings')
export class TeamSettingsController {
  constructor(private readonly settings: TeamSettingsUseCase) {}

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'team_settings_get',
    summary:
      'Si el equipo se enseña en la web de reservas y si las opiniones se revisan antes de publicarse.',
  })
  @ApiOkResponse({ type: TeamSettingsResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.settings.read(actor)) };
  }

  @Put()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'team_settings_save',
    summary: 'Cambia uno o los dos interruptores.',
  })
  @ApiOkResponse({ type: TeamSettingsResponseDto })
  async save(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
    @Body() body: TeamSettingsRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const saved = await this.settings.save(actor, {
      ...(body.showTeamOnWeb !== undefined && { showTeamOnWeb: body.showTeamOnWeb }),
      ...(body.reviewsNeedApproval !== undefined && {
        reviewsNeedApproval: body.reviewsNeedApproval,
      }),
    });
    return { ...saved };
  }
}
