import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../../shared/config/environment.schema';
import { determineCallerAudience } from '../domain/caller-access';
import {
  countRemainingCodeAttempts,
  isCodeLookupLocked,
  NO_CODE_ATTEMPTS,
  registerFailedCodeAttempt,
  type CodeAttemptState,
} from '../domain/code-attempts';
import {
  isCenterCodeFailureCapReached,
  resolveFailureWindowStart,
} from '../domain/code-failure-cap';
import { arePhoneNumbersEqual } from '../domain/phone-number';
import { normalizeSpokenStudentCode } from '../domain/student-code';
import { type VoiceToolReply } from './ports/voice-agent-provider';
import {
  VOICE_CALL_REPOSITORY,
  type VoiceCallerView,
  type VoiceCallRepository,
} from './ports/voice-call.repository';
import { replyOk, replyRefused, type VoiceCallContext } from './voice-call-context';
import { type IdentifyCallerArguments } from './voice-tool-schemas';

const TRANSFER_MESSAGE =
  'Demasiados códigos erróneos. Di que no puedes comprobarlo por teléfono y pasa la llamada a una persona.';

/**
 * Identifica a quien llama: con el código de 6 cifras de su perfil, o (si ya fue invitado antes) por su número.
 * El teléfono que llama solo es una pista; lo que abre la identidad es el código. Tras 3 códigos erróneos se
 * pasa a una persona. La identidad se guarda en la llamada: las demás herramientas no reciben ningún id del modelo.
 */
@Injectable()
export class IdentifyCallerUseCase {
  constructor(
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async execute(context: VoiceCallContext, args: IdentifyCallerArguments): Promise<VoiceToolReply> {
    if (context.caller !== null) return this.describeIdentified(context, context.caller);
    if (args.studentCode === undefined) return this.identifyPreviousGuest(context);
    return this.identifyByCode(context, args.studentCode);
  }

  private async identifyPreviousGuest(context: VoiceCallContext): Promise<VoiceToolReply> {
    const guest = await this.calls.findGuestByPhone(context.centerId, context.callerNumber);
    if (guest === null) {
      return replyOk({
        identified: false,
        audience: determineCallerAudience(context.disabledModules),
        message:
          'No se sabe quién llama. Pregunta si ya es alumno o cliente del centro y, si lo es, pide su código de 6 cifras.',
      });
    }
    await this.calls.bindCaller(context.centerId, context.providerCallId, guest.membershipId);
    return this.describeIdentified(context, guest);
  }

  private async identifyByCode(
    context: VoiceCallContext,
    spokenCode: string,
  ): Promise<VoiceToolReply> {
    const attempts = await this.calls.readCodeAttempts(context.centerId, context.callerNumber);
    if (isCodeLookupLocked(attempts, context.now) || (await this.isCenterCapReached(context))) {
      return replyRefused('too_many_attempts', TRANSFER_MESSAGE, { shouldTransfer: true });
    }
    const studentCode = normalizeSpokenStudentCode(spokenCode);
    const member =
      studentCode === null
        ? null
        : await this.calls.findCallerByStudentCode(context.centerId, studentCode);
    if (member === null) return this.rejectCode(context, attempts);

    await this.calls.writeCodeAttempts(context.centerId, context.callerNumber, NO_CODE_ATTEMPTS);
    await this.calls.bindCaller(context.centerId, context.providerCallId, member.membershipId);
    return this.describeIdentified(context, member);
  }

  /**
   * Tope de todo el centro: quien prueba códigos llamando desde muchos números distintos no lo frena el límite
   * por número. Con el tope alcanzado ya no se prueba ningún código, ni el bueno, y se pasa a una persona.
   */
  private async isCenterCapReached(context: VoiceCallContext): Promise<boolean> {
    const cap = this.config.get('VOICE_CENTER_CODE_FAILURES_PER_HOUR', { infer: true });
    const failures = await this.calls.countCenterCodeFailures(
      context.centerId,
      resolveFailureWindowStart(context.now),
    );
    return isCenterCodeFailureCapReached(failures, cap);
  }

  private async rejectCode(
    context: VoiceCallContext,
    attempts: CodeAttemptState,
  ): Promise<VoiceToolReply> {
    await this.calls.registerCenterCodeFailure(
      context.centerId,
      resolveFailureWindowStart(context.now),
    );
    const updated = registerFailedCodeAttempt(attempts, context.now);
    await this.calls.writeCodeAttempts(context.centerId, context.callerNumber, updated);
    if (isCodeLookupLocked(updated, context.now)) {
      return replyRefused('too_many_attempts', TRANSFER_MESSAGE, { shouldTransfer: true });
    }
    return replyRefused(
      'code_not_found',
      'Ese código no corresponde a nadie. Pídelo otra vez, cifra a cifra.',
      { remainingAttempts: countRemainingCodeAttempts(updated, context.now) },
    );
  }

  /** Solo el nombre de pila: el bot nunca cuenta otros datos de la persona. */
  private async describeIdentified(
    context: VoiceCallContext,
    caller: VoiceCallerView,
  ): Promise<VoiceToolReply> {
    const audience = determineCallerAudience(context.disabledModules);
    const remainingPassSessions =
      audience === 'student' && !caller.isGuest
        ? await this.calls.countRemainingPassSessions(
            context.centerId,
            caller.membershipId,
            context.now,
          )
        : null;
    return replyOk({
      identified: true,
      isGuest: caller.isGuest,
      firstName: caller.firstName,
      audience,
      phoneMatchesCaller:
        caller.storedPhone !== null &&
        arePhoneNumbersEqual(caller.storedPhone, context.callerNumber),
      ...(remainingPassSessions !== null && { remainingPassSessions }),
      capabilities: context.capabilities,
    });
  }
}
