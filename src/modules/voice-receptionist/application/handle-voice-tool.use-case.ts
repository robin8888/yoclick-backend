import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type z } from 'zod';
import { type VoiceToolInvocation, type VoiceToolReply } from './ports/voice-agent-provider';
import { VOICE_CALL_REPOSITORY, type VoiceCallRepository } from './ports/voice-call.repository';
import { IdentifyCallerUseCase } from './identify-caller.use-case';
import { ResolveVoiceCallUseCase } from './resolve-voice-call.use-case';
import { GetVoiceAvailabilityUseCase } from './voice-availability.use-case';
import {
  CancelVoiceBookingUseCase,
  CreateVoiceBookingUseCase,
  ListCallerBookingsUseCase,
  RescheduleVoiceBookingUseCase,
} from './voice-booking.use-cases';
import { type VoiceCallContext, replyRefused } from './voice-call-context';
import {
  addToWaitlistArguments,
  cancelBookingArguments,
  createBookingArguments,
  getAvailableSessionsArguments,
  getCallerBookingsArguments,
  identifyCallerArguments,
  rescheduleBookingArguments,
  transferCallArguments,
  type VoiceToolName,
} from './voice-tool-schemas';
import {
  AddCallerToVoiceWaitlistUseCase,
  TransferVoiceCallUseCase,
} from './voice-waitlist-and-transfer.use-cases';

type ToolRunner = (context: VoiceCallContext, rawArguments: unknown) => Promise<VoiceToolReply>;

const INVALID_ARGUMENTS_MESSAGE =
  'Faltan datos o no tienen el formato correcto. Vuelve a pedírselos a quien llama.';

/**
 * Valida los argumentos del modelo con su esquema estricto antes de ejecutar nada. Si no cuadran, el bot recibe
 * el aviso y vuelve a preguntar; nunca se ejecuta una herramienta con datos a medias.
 */
function withValidatedArguments<TSchema extends z.ZodType>(
  schema: TSchema,
  run: (context: VoiceCallContext, args: z.infer<TSchema>) => Promise<VoiceToolReply>,
): ToolRunner {
  return async (context, rawArguments) => {
    const parsed = schema.safeParse(rawArguments ?? {});
    if (!parsed.success) return replyRefused('invalid_arguments', INVALID_ARGUMENTS_MESSAGE);
    return run(context, parsed.data);
  };
}

/**
 * La puerta común de todas las herramientas del agente: resuelve el centro por el número puente, devuelve lo ya
 * respondido si el proveedor reintenta la misma orden (así una reserva no se crea dos veces) y ejecuta la
 * herramienta que toque.
 */
@Injectable()
export class HandleVoiceToolUseCase {
  private readonly runners: Readonly<Record<VoiceToolName, ToolRunner>>;

  constructor(
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    private readonly resolveCall: ResolveVoiceCallUseCase,
    moduleRef: ModuleRef,
  ) {
    // Cada herramienta es un caso de uso propio; se resuelven del módulo al usarlas (son sin estado).
    this.runners = {
      getAvailableSessions: withValidatedArguments(getAvailableSessionsArguments, (context, args) =>
        moduleRef.get(GetVoiceAvailabilityUseCase).execute(context, args),
      ),
      identifyCaller: withValidatedArguments(identifyCallerArguments, (context, args) =>
        moduleRef.get(IdentifyCallerUseCase).execute(context, args),
      ),
      getCallerBookings: withValidatedArguments(getCallerBookingsArguments, (context) =>
        moduleRef.get(ListCallerBookingsUseCase).execute(context),
      ),
      createBookingForCaller: withValidatedArguments(createBookingArguments, (context, args) =>
        moduleRef.get(CreateVoiceBookingUseCase).execute(context, args),
      ),
      cancelBookingForCaller: withValidatedArguments(cancelBookingArguments, (context, args) =>
        moduleRef.get(CancelVoiceBookingUseCase).execute(context, args),
      ),
      rescheduleBookingForCaller: withValidatedArguments(
        rescheduleBookingArguments,
        (context, args) => moduleRef.get(RescheduleVoiceBookingUseCase).execute(context, args),
      ),
      addCallerToWaitlist: withValidatedArguments(addToWaitlistArguments, (context, args) =>
        moduleRef.get(AddCallerToVoiceWaitlistUseCase).execute(context, args),
      ),
      transferCallToHuman: withValidatedArguments(transferCallArguments, (context) =>
        moduleRef.get(TransferVoiceCallUseCase).execute(context),
      ),
    };
  }

  async execute(
    toolName: VoiceToolName,
    invocation: VoiceToolInvocation,
    now: Date = new Date(),
  ): Promise<VoiceToolReply> {
    const resolved = await this.resolveCall.execute(invocation, now);
    if (resolved.kind === 'unavailable') return resolved.reply;

    const { context } = resolved;
    const orderKey = {
      providerCallId: invocation.providerCallId,
      toolCallId: invocation.toolCallId,
    };
    const previousReply = await this.calls.findToolReply(context.centerId, orderKey);
    if (previousReply !== null) return previousReply;

    const reply = await this.runners[toolName](context, invocation.rawArguments);
    // Solo se recuerda lo que se contestó con éxito o con un rechazo de negocio; un fallo del servidor lanza antes.
    await this.calls.saveToolReply(context.centerId, orderKey, reply);
    return reply;
  }
}
