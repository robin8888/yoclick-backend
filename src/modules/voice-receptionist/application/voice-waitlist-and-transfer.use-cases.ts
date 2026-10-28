import { Inject, Injectable } from '@nestjs/common';
import { JoinWaitlistUseCase } from '../../waitlist/application/waitlist.use-cases';
import { arePhoneNumbersEqual } from '../domain/phone-number';
import { type VoiceToolReply } from './ports/voice-agent-provider';
import { VOICE_CALL_REPOSITORY, type VoiceCallRepository } from './ports/voice-call.repository';
import {
  buildCallerActor,
  replyOk,
  replyRefused,
  type VoiceCallContext,
} from './voice-call-context';
import { toVoiceRefusal } from './voice-refusals';
import { describeLocalInstant } from './voice-time';
import { type AddToWaitlistArguments } from './voice-tool-schemas';

/** Apuntar a quien llama a la lista de espera de una clase llena. Solo planes con lista de espera, y solo alumnos. */
@Injectable()
export class AddCallerToVoiceWaitlistUseCase {
  constructor(
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    private readonly joinWaitlist: JoinWaitlistUseCase,
  ) {}

  async execute(context: VoiceCallContext, args: AddToWaitlistArguments): Promise<VoiceToolReply> {
    if (!context.capabilities.canJoinWaitlist || context.disabledModules.includes('waitlist')) {
      return replyRefused(
        'waitlist_not_included',
        'Este centro no tiene lista de espera por teléfono. Ofrece otra clase o pasa la llamada a una persona.',
      );
    }
    if (context.caller === null || context.caller.isGuest) {
      return replyRefused(
        'not_a_student',
        'La lista de espera es para alumnos y clientes identificados con su código.',
      );
    }
    try {
      const entry = await this.joinWaitlist.execute(buildCallerActor(context, context.caller), {
        classSessionId: args.classSessionId,
        now: context.now,
      });
      await this.calls.mergeCallOutcome(context.centerId, context.providerCallId, 'waitlist');
      return replyOk({
        waitlisted: {
          service: entry.session.service.name,
          when: describeLocalInstant(entry.session.startsAt, context.timeZone),
          position: entry.position,
        },
      });
    } catch (error) {
      return toVoiceRefusal(error);
    }
  }
}

/** Pasa la llamada a una persona del centro, nunca al teléfono del propio centro (sería un bucle). */
@Injectable()
export class TransferVoiceCallUseCase {
  constructor(@Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository) {}

  async execute(context: VoiceCallContext): Promise<VoiceToolReply> {
    await this.calls.mergeCallOutcome(context.centerId, context.providerCallId, 'transfer');
    const transferPhone = context.config?.humanTransferPhone ?? null;
    if (transferPhone === null || arePhoneNumbersEqual(transferPhone, context.callerNumber)) {
      return replyRefused(
        'no_transfer_number',
        'Ahora no hay nadie a quien pasar la llamada. Pide disculpas, toma nota del recado y di que el centro le devolverá la llamada.',
      );
    }
    return { result: { ok: true, transferring: true }, transferToNumber: transferPhone };
  }
}
