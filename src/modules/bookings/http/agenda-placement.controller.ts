import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
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
import { ActivityRecorder } from '../../activity/application/activity-recorder';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import {
  GetGroupOptionsUseCase,
  GetPlacementOptionsUseCase,
  JoinGroupSessionUseCase,
} from '../application/booking.use-cases';
import {
  BookingResponseDto,
  CenterRouteParamsDto,
  GroupOptionsQueryDto,
  GroupOptionsResponseDto,
  JoinGroupSessionRequestDto,
  PlacementOptionsQueryDto,
  PlacementOptionsResponseDto,
} from './booking.dto';
import { serializeBooking } from './serialize-booking';

/** Quien pone la cita desde la agenda puede elegir cualquier cuarto de hora (10:00, 10:15, 10:30…). */
const AGENDA_SLOT_STEP_MINUTES = 15;

/** Salas y clases grupales en la agenda del centro: ver qué cabe y apuntar a alguien a un grupo. */
@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/agenda')
export class AgendaPlacementController {
  constructor(
    private readonly joinGroupSession: JoinGroupSessionUseCase,
    private readonly getPlacementOptions: GetPlacementOptionsUseCase,
    private readonly getGroupOptions: GetGroupOptionsUseCase,
    private readonly activity: ActivityRecorder,
    private readonly push: PushDispatcher,
  ) {}

  @Post('bookings/join-group')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'agenda_join_group_session',
    summary:
      'Apunta a un cliente a una clase grupal que ya existe (misma hora, profesional y sala). 409 SESSION_FULL si ya no quedan plazas, ALREADY_BOOKED si el cliente tiene otra cita a esa hora.',
  })
  @ApiCreatedResponse({ type: BookingResponseDto })
  async joinGroup(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: JoinGroupSessionRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const booking = await this.joinGroupSession.execute(actor, {
      classSessionId: body.classSessionId,
      clientMembershipId: body.clientMembershipId,
      now: new Date(),
    });
    await this.activity.record(actor, {
      kind: 'booking_created_by_team',
      subject: booking.service.name,
    });
    await this.push.flushCenter(actor);
    return serializeBooking(booking);
  }

  @Get('placement-options')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'agenda_get_placement_options',
    summary:
      'Para poner una cita: las horas libres de una profesional un día (cada cuarto de hora) con las salas libres que puede usar, y las clases grupales suyas a las que aún caben más personas.',
  })
  @ApiOkResponse({ type: PlacementOptionsResponseDto })
  async getOptions(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: PlacementOptionsQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const options = await this.getPlacementOptions.execute(actor, {
      serviceId: query.serviceId,
      staffMembershipId: query.staffMembershipId,
      date: query.date,
      now: new Date(),
      stepMinutes: AGENDA_SLOT_STEP_MINUTES,
    });
    return {
      timezone: options.timeZone,
      hasUsableRooms: options.hasUsableRooms,
      openSlots: options.openSlots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        freeRooms: slot.freeRooms,
      })),
      groupSessions: options.groupSessions.map((session) => ({
        ...session,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
      })),
    };
  }

  @Get('group-options')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'agenda_get_group_options',
    summary:
      'Para una cita grupal: cada sala con profesor que da el servicio, con sus horas libres ese día (profesor y sala libres) y sus grupos con plazas. En una cita grupal el profesor lo define la sala.',
  })
  @ApiOkResponse({ type: GroupOptionsResponseDto })
  async getGroups(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: GroupOptionsQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const options = await this.getGroupOptions.execute(actor, {
      serviceId: query.serviceId,
      date: query.date,
      now: new Date(),
      stepMinutes: AGENDA_SLOT_STEP_MINUTES,
    });
    return {
      timezone: options.timeZone,
      rooms: options.rooms.map((roomOptions) => ({
        room: roomOptions.room,
        openSlots: roomOptions.openSlots.map((slot) => ({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
        })),
        groupSessions: roomOptions.groupSessions.map((session) => ({
          ...session,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
        })),
      })),
    };
  }
}
