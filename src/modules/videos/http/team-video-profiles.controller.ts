import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import { VideoPresenter } from '../application/video-presenter';
import { ListTeamProfilesUseCase, ReviewVideoUseCase } from '../application/video.use-cases';
import {
  CenterRouteParamsDto,
  ReviewVideoRequestDto,
  TeamProfilesResponseDto,
  VideoResponseDto,
  VideoRouteParamsDto,
} from './video.dto';

/** El vídeo de presentación del equipo: lo revisa el centro y lo ve la clientela cuando está aprobado. */
@ApiTags('videos')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class TeamVideoProfilesController {
  constructor(
    private readonly reviewVideo: ReviewVideoUseCase,
    private readonly listTeamProfiles: ListTeamProfilesUseCase,
    private readonly presenter: VideoPresenter,
    private readonly push: PushDispatcher,
  ) {}

  @Post('videos/:videoId/review')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'videos_review',
    summary:
      'Aprueba o pide cambios en un vídeo de presentación pendiente; quien lo subió lo sabe por un aviso push.',
  })
  @ApiOkResponse({ type: VideoResponseDto })
  async review(
    @CurrentActor() actor: ActorContext,
    @Param() params: VideoRouteParamsDto,
    @Body() body: ReviewVideoRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const video = await this.reviewVideo.execute({
      actor,
      videoId: params.videoId,
      isApproved: body.decision === 'approve',
      note: body.note ?? null,
    });
    await this.push.flushCenter(actor);
    return { ...this.presenter.present(video, { isClient: false }) };
  }

  @Get('team-profiles')
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'videos_list_team_profiles',
    summary:
      'El equipo con su vídeo de presentación. La clientela solo ve los listos y aprobados; la administración, todos.',
  })
  @ApiOkResponse({ type: TeamProfilesResponseDto })
  async teamProfiles(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const isClient = actor.role === 'client';
    const profiles = await this.listTeamProfiles.execute(actor);
    return {
      members: profiles.map((profile) => ({
        ...profile,
        video: profile.video && this.presenter.present(profile.video, { isClient }),
      })),
    };
  }
}
