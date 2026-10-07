import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { serializeReview } from '../application/profile-presenter';
import {
  CreateStaffReviewUseCase,
  ListStaffReviewsUseCase,
  ModerateStaffReviewUseCase,
} from '../application/staff-review.use-cases';
import {
  CenterParamsDto,
  CreateReviewRequestDto,
  MemberParamsDto,
  ModerateReviewRequestDto,
  ReviewParamsDto,
  StaffReviewListResponseDto,
  StaffReviewResponseDto,
} from './team-profile.dto';

/** Opiniones sobre el equipo: solo de una sesión real, una por sesión, y el centro puede revisarlas antes. */
@ApiTags('team-profiles')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class StaffReviewsController {
  constructor(
    private readonly createReview: CreateStaffReviewUseCase,
    private readonly listReviews: ListStaffReviewsUseCase,
    private readonly moderateReview: ModerateStaffReviewUseCase,
    private readonly push: PushDispatcher,
  ) {}

  @Post('team-profiles/:membershipId/reviews')
  @Roles('client')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'staff_reviews_create',
    summary:
      'Opina sobre quien te dio una sesión (de 1 a 5). Si el centro revisa las opiniones queda pendiente. 409 REVIEW_NOT_ALLOWED si no hay una sesión tuya con esa persona sin opinión.',
  })
  @ApiCreatedResponse({ type: StaffReviewResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: MemberParamsDto,
    @Body() body: CreateReviewRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const review = await this.createReview.execute({
      actor,
      staffMembershipId: params.membershipId,
      rating: body.rating,
      comment: body.comment,
    });
    await this.push.flushCenter(actor);
    return serializeReview(review);
  }

  @Get('team-profiles/:membershipId/reviews')
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'staff_reviews_list',
    summary:
      'Las opiniones publicadas sobre una persona del equipo, de la más reciente a la más antigua.',
  })
  @ApiOkResponse({ type: StaffReviewListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: MemberParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const reviews = await this.listReviews.listPublished(actor, params.membershipId);
    return { reviews: reviews.map(serializeReview) };
  }

  @Get('staff-reviews/pending')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'staff_reviews_list_pending',
    summary:
      'Las opiniones que esperan la revisión del centro, de la más antigua a la más reciente.',
  })
  @ApiOkResponse({ type: StaffReviewListResponseDto })
  async listPending(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const reviews = await this.listReviews.listPending(actor);
    return { reviews: reviews.map(serializeReview) };
  }

  @Post('staff-reviews/:reviewId/moderate')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'staff_reviews_moderate',
    summary:
      'Publica o rechaza una opinión pendiente; si se publica, la persona del equipo lo sabe por push. 409 REVIEW_NOT_MODERABLE si ya estaba revisada.',
  })
  @ApiOkResponse({ type: StaffReviewResponseDto })
  async moderate(
    @CurrentActor() actor: ActorContext,
    @Param() params: ReviewParamsDto,
    @Body() body: ModerateReviewRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const review = await this.moderateReview.execute({
      actor,
      reviewId: params.reviewId,
      isApproved: body.decision === 'approve',
    });
    await this.push.flushCenter(actor);
    return serializeReview(review);
  }
}
