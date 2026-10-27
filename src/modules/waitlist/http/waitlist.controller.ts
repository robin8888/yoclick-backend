import { RequiresModule } from '../../../shared/auth/decorators/requires-module.decorator';
import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import { BookingResponseDto } from '../../bookings/http/booking.dto';
import { serializeBooking } from '../../bookings/http/serialize-booking';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import {
  ConfirmWaitlistOfferUseCase,
  JoinWaitlistUseCase,
  LeaveWaitlistUseCase,
  ListMyWaitlistUseCase,
} from '../application/waitlist.use-cases';
import {
  CenterRouteParamsDto,
  MyWaitlistResponseDto,
  SessionWaitlistRouteParamsDto,
  WaitlistEntryResponseDto,
  WaitlistEntryRouteParamsDto,
} from './waitlist.dto';
import { serializeWaitlistEntry } from './serialize-waitlist-entry';

/**
 * Lista de espera de las clases llenas. Al liberarse una plaza se le ofrece a la primera persona,
 * que tiene 12 horas para confirmarla; si no, pasa a la siguiente.
 */
@ApiTags('waitlist')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@RequiresPlanFeature('waitlist')
@Controller('centers/:centerId')
export class WaitlistController {
  constructor(
    private readonly joinWaitlist: JoinWaitlistUseCase,
    private readonly leaveWaitlist: LeaveWaitlistUseCase,
    private readonly listMyWaitlist: ListMyWaitlistUseCase,
    private readonly confirmOffer: ConfirmWaitlistOfferUseCase,
    private readonly push: PushDispatcher,
  ) {}

  @Get('waitlist/mine')
  @Roles('client')
  @ApiOperation({
    operationId: 'waitlist_list_mine',
    summary:
      'Las clases en cuya lista de espera está la persona: en cola (con su lugar) o con una plaza ofrecida pendiente de confirmar.',
  })
  @ApiOkResponse({ type: MyWaitlistResponseDto })
  async listMine(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const entries = await this.listMyWaitlist.execute(actor, { now: new Date() });
    return { entries: entries.map(serializeWaitlistEntry) };
  }

  @RequiresModule('waitlist')
  @Post('class-sessions/:classSessionId/waitlist')
  @Roles('client')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'waitlist_join',
    summary:
      'La persona se apunta a la lista de espera de una clase grupal llena. 409 WAITLIST_SESSION_HAS_SEATS si aún quedan plazas, WAITLIST_ALREADY_JOINED si ya espera, ALREADY_BOOKED si ya tiene plaza.',
  })
  @ApiCreatedResponse({ type: WaitlistEntryResponseDto })
  async join(
    @CurrentActor() actor: ActorContext,
    @Param() params: SessionWaitlistRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const entry = await this.joinWaitlist.execute(actor, {
      classSessionId: params.classSessionId,
      now: new Date(),
    });
    return serializeWaitlistEntry(entry);
  }

  @Post('waitlist/:entryId/leave')
  @Roles('client')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'waitlist_leave',
    summary:
      'Sale de la lista de espera. Si ya tenía una plaza ofrecida, esa plaza se ofrece a la siguiente persona.',
  })
  @ApiNoContentResponse()
  async leave(
    @CurrentActor() actor: ActorContext,
    @Param() params: WaitlistEntryRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.leaveWaitlist.execute(actor, { entryId: params.entryId });
    await this.push.flushCenter(actor);
  }

  @RequiresModule('waitlist')
  @Post('waitlist/:entryId/confirm')
  @Roles('client')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'waitlist_confirm',
    summary:
      'Confirma la plaza ofrecida y crea la reserva. 409 WAITLIST_OFFER_EXPIRED si pasaron las 12 horas; el resto de errores son los de apuntarse a una clase (bono sin clases, otra cita a esa hora…).',
  })
  @ApiCreatedResponse({ type: BookingResponseDto })
  async confirm(
    @CurrentActor() actor: ActorContext,
    @Param() params: WaitlistEntryRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const booking = await this.confirmOffer.execute(actor, {
      entryId: params.entryId,
      now: new Date(),
    });
    await this.push.flushCenter(actor);
    return serializeBooking(booking);
  }
}
