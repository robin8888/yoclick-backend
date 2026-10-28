import { Inject, Injectable } from '@nestjs/common';
import { GetAvailabilityUseCase } from '../../scheduling/application/get-availability.use-case';
import { ListServiceSessionsUseCase } from '../../bookings/application/booking.use-cases';
import { canGuestBookService } from '../domain/caller-access';
import { type VoiceToolReply } from './ports/voice-agent-provider';
import {
  VOICE_CALL_REPOSITORY,
  type VoiceCallRepository,
  type VoiceServiceView,
} from './ports/voice-call.repository';
import {
  buildCallerActor,
  buildVisitorActor,
  replyOk,
  replyRefused,
  type VoiceCallContext,
} from './voice-call-context';
import { toVoiceRefusal } from './voice-refusals';
import { addDaysToDate, describeLocalInstant, formatLocalDate } from './voice-time';
import { type GetAvailableSessionsArguments } from './voice-tool-schemas';

const DEFAULT_LOOKAHEAD_DAYS = 6;
const MAX_OFFERED_OPTIONS = 12;

/** Los servicios que el bot puede ofrecer a quien llama: un invitado solo ve lo que puede reservar. */
function isOfferedToCaller(service: VoiceServiceView, context: VoiceCallContext): boolean {
  if (service.mode === 'group' && !context.capabilities.canBookGroupSessions) return false;
  if (context.caller !== null && !context.caller.isGuest) return true;
  return canGuestBookService({
    disabledModules: context.disabledModules,
    serviceAllowsTrialBookings: service.allowsTrialBookings,
  });
}

function describeService(service: VoiceServiceView): Record<string, unknown> {
  return {
    serviceId: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    isGroupClass: service.mode === 'group',
    isTrialClass: service.allowsTrialBookings,
  };
}

/** Qué se puede reservar y cuándo: los servicios del centro y, de uno, sus horas libres o clases con plaza. */
@Injectable()
export class GetVoiceAvailabilityUseCase {
  constructor(
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    private readonly availability: GetAvailabilityUseCase,
    private readonly serviceSessions: ListServiceSessionsUseCase,
  ) {}

  async execute(
    context: VoiceCallContext,
    args: GetAvailableSessionsArguments,
  ): Promise<VoiceToolReply> {
    if (args.serviceId === undefined) return this.listServices(context);
    const service = await this.calls.findService(context.centerId, args.serviceId);
    if (service === null || !isOfferedToCaller(service, context)) {
      return replyRefused(
        'service_not_offered',
        'Ese servicio no se puede reservar por teléfono. Ofrece los que sí aparecen en la lista.',
      );
    }
    try {
      return service.mode === 'group'
        ? await this.listGroupClasses(context, service, args)
        : await this.listFreeHours(context, service, args);
    } catch (error) {
      return toVoiceRefusal(error);
    }
  }

  private async listServices(context: VoiceCallContext): Promise<VoiceToolReply> {
    const services = await this.calls.listServices(context.centerId);
    return replyOk({
      services: services
        .filter((service) => isOfferedToCaller(service, context))
        .map(describeService),
    });
  }

  private resolveRange(
    context: VoiceCallContext,
    args: GetAvailableSessionsArguments,
  ): { from: string; to: string } {
    const from = args.from ?? formatLocalDate(context.now, context.timeZone);
    return { from, to: args.to ?? addDaysToDate(from, DEFAULT_LOOKAHEAD_DAYS) };
  }

  private async listFreeHours(
    context: VoiceCallContext,
    service: VoiceServiceView,
    args: GetAvailableSessionsArguments,
  ): Promise<VoiceToolReply> {
    const { from, to } = this.resolveRange(context, args);
    const actor =
      context.caller === null
        ? buildVisitorActor(context)
        : buildCallerActor(context, context.caller);
    const result = await this.availability.execute({
      actor,
      serviceId: service.id,
      fromDate: from,
      toDate: to,
      staffMembershipId: null,
      stepMinutes: null,
      now: context.now,
    });
    const options = result.days
      .flatMap((day) => day.slots)
      .slice(0, MAX_OFFERED_OPTIONS)
      .map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        when: describeLocalInstant(slot.startsAt, result.timeZone),
        staffName: slot.staffName,
      }));
    return replyOk({ service: describeService(service), options });
  }

  private async listGroupClasses(
    context: VoiceCallContext,
    service: VoiceServiceView,
    args: GetAvailableSessionsArguments,
  ): Promise<VoiceToolReply> {
    const { from, to } = this.resolveRange(context, args);
    const actor =
      context.caller === null
        ? buildVisitorActor(context)
        : buildCallerActor(context, context.caller);
    const result = await this.serviceSessions.execute(actor, {
      serviceId: service.id,
      fromDate: from,
      toDate: to,
      now: context.now,
      shouldIncludeFull: context.capabilities.canJoinWaitlist,
    });
    const options = result.sessions.slice(0, MAX_OFFERED_OPTIONS).map((session) => ({
      classSessionId: session.id,
      startsAt: session.startsAt.toISOString(),
      when: describeLocalInstant(session.startsAt, result.timeZone),
      teacherName: session.teacher.fullName,
      remainingSeats: session.remainingSeats,
    }));
    return replyOk({ service: describeService(service), options });
  }
}
