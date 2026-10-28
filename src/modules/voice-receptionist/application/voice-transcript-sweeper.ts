import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { VOICE_ADMIN_REPOSITORY, type VoiceAdminRepository } from './ports/voice-admin.repository';

/** Cada cuánto se revisan las transcripciones vencidas si no se configura otra cosa. */
const DEFAULT_SWEEP_INTERVAL_SECONDS = 3600;

/**
 * Borra las transcripciones que han cumplido la retención de su centro (RGPD: no se guardan más de lo
 * necesario). Del resto de la llamada (duración, resumen, resultado) no se borra nada. Corre dentro de la API;
 * `VOICE_TRANSCRIPT_SWEEP_INTERVAL_SECONDS=0` lo apaga (los tests lo lanzan a mano con `clearExpired`).
 */
@Injectable()
export class VoiceTranscriptSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceTranscriptSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository,
    private readonly config: ConfigService,
  ) {}

  async clearExpired(now: Date = new Date()): Promise<number> {
    return this.admin.clearExpiredTranscripts(now);
  }

  onModuleInit(): void {
    const intervalSeconds = Number(
      this.config.get('VOICE_TRANSCRIPT_SWEEP_INTERVAL_SECONDS') ?? DEFAULT_SWEEP_INTERVAL_SECONDS,
    );
    if (intervalSeconds <= 0) return;
    this.timer = setInterval(() => {
      this.clearExpired().catch((error: unknown) => {
        this.logger.error('The voice transcript sweep failed', error);
      });
    }, intervalSeconds * MILLISECONDS_PER_SECOND);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
