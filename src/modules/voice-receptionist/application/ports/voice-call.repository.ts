import { type VoiceCallOutcomeName } from '../../domain/call-outcome';
import { type CodeAttemptState } from '../../domain/code-attempts';
import { type UsageAlertPercent, type VoiceOveragePolicyName } from '../../domain/usage-minutes';
import { type VoiceCallEnd, type VoiceToolReply } from './voice-agent-provider';

export type VoiceForwardingModeName = 'always' | 'no_answer' | 'busy' | 'outside_hours';

export interface VoiceAgentConfigView {
  readonly greeting: string | null;
  readonly assistantName: string | null;
  readonly voice: string | null;
  readonly language: string;
  readonly forwardingMode: VoiceForwardingModeName;
  readonly humanTransferPhone: string | null;
  readonly legalNotice: string | null;
  readonly transcriptRetentionDays: number;
  readonly overagePolicy: VoiceOveragePolicyName;
}

/** Los minutos del periodo en curso frente a los incluidos en el add-on. */
export interface VoiceUsageSnapshot {
  readonly includedMinutes: number;
  readonly usedMinutes: number;
}

/** Lo que hace falta saber de un centro y de su contestador para atender una llamada. */
export interface VoiceCenterSnapshot {
  readonly centerId: string;
  readonly planId: string;
  readonly timeZone: string;
  readonly disabledModules: readonly string[];
  readonly isClosed: boolean;
  readonly isVoiceReceptionistEnabled: boolean;
  /** `null` si el centro no ha contratado el add-on. */
  readonly subscriptionStatus: 'active' | 'paused' | 'cancelled' | null;
  readonly config: VoiceAgentConfigView | null;
  /** `null` si el centro no ha contratado el add-on. */
  readonly usage: VoiceUsageSnapshot | null;
}

/** Lo que dejó una llamada al cerrarse: su exceso de minutos y qué avisos al propietario tocan ahora. */
export interface VoiceCallFinishOutcome {
  readonly callLogId: string;
  /** Minutos de esta llamada que pasaron de lo incluido; es lo que se factura como exceso. */
  readonly overageMinutes: number;
  /** Umbrales cruzados por esta llamada que aún no se habían avisado en el periodo (ya apuntados). */
  readonly alertsToSend: readonly UsageAlertPercent[];
  readonly usage: VoiceUsageSnapshot | null;
}

/** Lo que se cuenta al propietario en un aviso de minutos. */
export interface VoiceUsageAlertFacts {
  readonly centerName: string;
  readonly overagePolicy: VoiceOveragePolicyName;
  /** `null` si el escalón del plan no tiene precio de exceso. */
  readonly overageCentsPerMinute: number | null;
}

export interface VoiceLineView {
  readonly centerId: string;
  readonly isActive: boolean;
}

/** Una persona del centro que ha llamado (alumno, cliente o invitado del propio contestador). */
export interface VoiceCallerView {
  readonly membershipId: string;
  readonly userId: string;
  readonly firstName: string;
  readonly isGuest: boolean;
  /** Su teléfono guardado en la cuenta, para comparar con el que llama. */
  readonly storedPhone: string | null;
}

export interface VoiceServiceView {
  readonly id: string;
  readonly name: string;
  readonly mode: 'private' | 'group' | 'both';
  readonly durationMinutes: number;
  readonly allowsTrialBookings: boolean;
  readonly isRental: boolean;
}

export interface VoiceCallRepository {
  /** El centro de una llamada se decide solo por el número puente al que se llamó. */
  findLineByNumber(calledNumber: string): Promise<VoiceLineView | null>;
  loadCenterSnapshot(centerId: string, now: Date): Promise<VoiceCenterSnapshot | null>;

  /** Crea el registro de la llamada si es la primera orden y devuelve con quién se identificó ya. */
  openCallLog(
    centerId: string,
    call: { providerCallId: string; callerPhone: string; now: Date },
  ): Promise<{ callerMembershipId: string | null }>;
  bindCaller(centerId: string, providerCallId: string, membershipId: string): Promise<void>;
  mergeCallOutcome(
    centerId: string,
    providerCallId: string,
    outcome: VoiceCallOutcomeName,
  ): Promise<void>;

  /** Códigos erróneos de todo el centro en la hora que empieza en `windowStart`, con cualquier número. */
  countCenterCodeFailures(centerId: string, windowStart: Date): Promise<number>;
  registerCenterCodeFailure(centerId: string, windowStart: Date): Promise<void>;

  readCodeAttempts(centerId: string, callerPhone: string): Promise<CodeAttemptState>;
  writeCodeAttempts(centerId: string, callerPhone: string, state: CodeAttemptState): Promise<void>;

  findCallerByStudentCode(centerId: string, studentCode: string): Promise<VoiceCallerView | null>;
  findCallerByMembershipId(centerId: string, membershipId: string): Promise<VoiceCallerView | null>;
  findGuestByPhone(centerId: string, callerPhone: string): Promise<VoiceCallerView | null>;
  createGuest(
    centerId: string,
    guest: { fullName: string; phone: string },
  ): Promise<VoiceCallerView>;

  listServices(centerId: string): Promise<readonly VoiceServiceView[]>;
  findService(centerId: string, serviceId: string): Promise<VoiceServiceView | null>;
  /** Clases que le quedan en bonos en vigor; 0 si no tiene ninguno. */
  countRemainingPassSessions(centerId: string, membershipId: string, now: Date): Promise<number>;

  findToolReply(
    centerId: string,
    call: { providerCallId: string; toolCallId: string },
  ): Promise<VoiceToolReply | null>;
  saveToolReply(
    centerId: string,
    call: { providerCallId: string; toolCallId: string },
    reply: VoiceToolReply,
  ): Promise<void>;

  /**
   * Cierra la llamada, suma sus minutos al periodo, apunta cuánto fue exceso y qué avisos de consumo tocan.
   * Idempotente: si el proveedor repite el informe, no suma ni avisa otra vez.
   */
  finishCall(
    centerId: string,
    end: VoiceCallEnd,
    billedMinutes: number,
  ): Promise<VoiceCallFinishOutcome>;
  readUsageAlertFacts(centerId: string): Promise<VoiceUsageAlertFacts | null>;
}

export const VOICE_CALL_REPOSITORY = Symbol('VOICE_CALL_REPOSITORY');
