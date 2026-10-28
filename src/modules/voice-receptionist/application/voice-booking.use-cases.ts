import { Inject, Injectable } from '@nestjs/common';
import {
  CancelBookingUseCase,
  CreateBookingUseCase,
  JoinGroupSessionUseCase,
  ListMyBookingsUseCase,
  RescheduleBookingUseCase,
} from '../../bookings/application/booking.use-cases';
import { type BookingView } from '../../bookings/application/ports/booking.repository';
import { canGuestBookService } from '../domain/caller-access';
import { deriveBookingIdempotencyKey } from '../domain/tool-idempotency';
import { type VoiceToolReply } from './ports/voice-agent-provider';
import {
  VOICE_CALL_REPOSITORY,
  type VoiceCallerView,
  type VoiceCallRepository,
  type VoiceServiceView,
} from './ports/voice-call.repository';
import {
  buildCallerActor,
  replyOk,
  replyRefused,
  type VoiceCallContext,
} from './voice-call-context';
import { toVoiceRefusal } from './voice-refusals';
import { describeLocalInstant } from './voice-time';
import {
  type CancelBookingArguments,
  type CreateBookingArguments,
  type RescheduleBookingArguments,
} from './voice-tool-schemas';

const MAX_LISTED_BOOKINGS = 10;

const NOT_IDENTIFIED = replyRefused(
  'not_identified',
  'Todavía no sabes quién llama. Pídele su código de alumno o cliente.',
);

function describeBooking(booking: BookingView, timeZone: string): Record<string, unknown> {
  return {
    bookingId: booking.id,
    serviceName: booking.service.name,
    startsAt: booking.startsAt.toISOString(),
    when: describeLocalInstant(booking.startsAt, timeZone),
    staffName: booking.staff.fullName,
  };
}

/** Las citas de quien llama, para que pueda decir cuál quiere cancelar o cambiar. */
@Injectable()
export class ListCallerBookingsUseCase {
  constructor(private readonly myBookings: ListMyBookingsUseCase) {}

  async execute(context: VoiceCallContext): Promise<VoiceToolReply> {
    if (context.caller === null) return NOT_IDENTIFIED;
    const bookings = await this.myBookings.execute({
      actor: buildCallerActor(context, context.caller),
      scope: 'upcoming',
      limit: MAX_LISTED_BOOKINGS,
      now: context.now,
    });
    return replyOk({
      bookings: bookings
        .filter((booking) => booking.status === 'confirmed')
        .map((booking) => describeBooking(booking, context.timeZone)),
    });
  }
}

/**
 * Reserva con exactamente las mismas reglas que la app (aforo, bonos, horarios, antelación): se llama a los
 * mismos casos de uso con quien llama como cliente. Quien no es alumno ni cliente queda como invitado y solo
 * puede reservar lo que el centro admite (cita de prueba si usa bonos).
 */
@Injectable()
export class CreateVoiceBookingUseCase {
  constructor(
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    private readonly createBooking: CreateBookingUseCase,
    private readonly joinGroupSession: JoinGroupSessionUseCase,
  ) {}

  async execute(context: VoiceCallContext, args: CreateBookingArguments): Promise<VoiceToolReply> {
    const service = await this.calls.findService(context.centerId, args.serviceId);
    if (service === null) {
      return replyRefused('service_not_found', 'Ese servicio no existe. Ofrece los de la lista.');
    }
    const refusal = this.checkServiceIsBookable(context, service, args);
    if (refusal !== null) return refusal;

    const caller = await this.resolveCaller(context, args);
    if ('reply' in caller) return caller.reply;
    try {
      const booking = await this.book(context, caller.view, args);
      await this.calls.mergeCallOutcome(context.centerId, context.providerCallId, 'booking');
      return replyOk({ booked: describeBooking(booking, context.timeZone) });
    } catch (error) {
      return toVoiceRefusal(error);
    }
  }

  private checkServiceIsBookable(
    context: VoiceCallContext,
    service: VoiceServiceView,
    args: CreateBookingArguments,
  ): VoiceToolReply | null {
    if (service.mode === 'group' && !context.capabilities.canBookGroupSessions) {
      return replyRefused(
        'group_not_included',
        'Este centro no reserva clases en grupo por teléfono.',
      );
    }
    if (service.mode === 'group' && args.classSessionId === undefined) {
      return replyRefused(
        'session_required',
        'Elige una de las clases disponibles de ese servicio.',
      );
    }
    const isGuest = context.caller === null || context.caller.isGuest;
    const canBook =
      !isGuest ||
      canGuestBookService({
        disabledModules: context.disabledModules,
        serviceAllowsTrialBookings: service.allowsTrialBookings,
      });
    return canBook
      ? null
      : replyRefused(
          'trial_only',
          'Quien no es alumno solo puede reservar una cita de prueba. Ofrécele esa y, para lo demás, pasa la llamada a una persona.',
          { shouldTransfer: true },
        );
  }

  /** Quien llama sin identificar se da de alta como invitado (o se reconoce si ya lo fue por su número). */
  private async resolveCaller(
    context: VoiceCallContext,
    args: CreateBookingArguments,
  ): Promise<{ view: VoiceCallerView } | { reply: VoiceToolReply }> {
    if (context.caller !== null) return { view: context.caller };
    const previousGuest = await this.calls.findGuestByPhone(context.centerId, context.callerNumber);
    if (previousGuest !== null) {
      await this.calls.bindCaller(
        context.centerId,
        context.providerCallId,
        previousGuest.membershipId,
      );
      return { view: previousGuest };
    }
    if (args.guestFullName === undefined) {
      return {
        reply: replyRefused(
          'guest_name_required',
          'Para reservar necesitas el nombre y los apellidos de quien llama.',
        ),
      };
    }
    const guest = await this.calls.createGuest(context.centerId, {
      fullName: args.guestFullName,
      phone: context.callerNumber,
    });
    await this.calls.bindCaller(context.centerId, context.providerCallId, guest.membershipId);
    return { view: guest };
  }

  private async book(
    context: VoiceCallContext,
    caller: VoiceCallerView,
    args: CreateBookingArguments,
  ): Promise<BookingView> {
    const actor = buildCallerActor(context, caller);
    if (args.classSessionId !== undefined) {
      return this.joinGroupSession.execute(actor, {
        classSessionId: args.classSessionId,
        clientMembershipId: caller.membershipId,
        now: context.now,
        isClientBooking: true,
      });
    }
    return this.createBooking.execute(actor, {
      serviceId: args.serviceId,
      startsAt: new Date(args.startsAt),
      preferredStaffMembershipId: null,
      idempotencyKey: deriveBookingIdempotencyKey(context.providerCallId, context.toolCallId),
      now: context.now,
    });
  }
}

/** Cancela solo citas de la persona identificada en esta llamada: el caso de uso busca la cita entre las suyas. */
@Injectable()
export class CancelVoiceBookingUseCase {
  constructor(
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    private readonly cancelBooking: CancelBookingUseCase,
  ) {}

  async execute(context: VoiceCallContext, args: CancelBookingArguments): Promise<VoiceToolReply> {
    if (context.caller === null) return NOT_IDENTIFIED;
    try {
      const result = await this.cancelBooking.execute({
        actor: buildCallerActor(context, context.caller),
        bookingId: args.bookingId,
        now: context.now,
      });
      await this.calls.mergeCallOutcome(context.centerId, context.providerCallId, 'cancellation');
      return replyOk({
        cancelled: describeBooking(result.booking, context.timeZone),
        withinFreeCancellation: result.withinPolicy,
      });
    } catch (error) {
      return toVoiceRefusal(error);
    }
  }
}

@Injectable()
export class RescheduleVoiceBookingUseCase {
  constructor(
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    private readonly rescheduleBooking: RescheduleBookingUseCase,
  ) {}

  async execute(
    context: VoiceCallContext,
    args: RescheduleBookingArguments,
  ): Promise<VoiceToolReply> {
    if (context.caller === null) return NOT_IDENTIFIED;
    try {
      const outcome = await this.rescheduleBooking.execute(
        buildCallerActor(context, context.caller),
        {
          bookingId: args.bookingId,
          startsAt: new Date(args.startsAt),
          now: context.now,
        },
      );
      await this.calls.mergeCallOutcome(context.centerId, context.providerCallId, 'reschedule');
      return replyOk({ rescheduled: describeBooking(outcome.booking, context.timeZone) });
    } catch (error) {
      return toVoiceRefusal(error);
    }
  }
}
