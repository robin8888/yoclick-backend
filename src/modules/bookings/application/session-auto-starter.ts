import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import {
  SESSION_RECORD_REPOSITORY,
  type SessionRecordRepository,
} from './ports/session-record.repository';

/** Cada cuánto se miran las citas que han llegado a su hora si no se configura otra cosa. */
const DEFAULT_AUTO_START_INTERVAL_SECONDS = 30;

/**
 * Inicia solas, a su hora, las clases y citas de los centros que lo tienen activado. Corre dentro de
 * la propia API; si hubiera varias instancias, el inicio es idempotente (una cita ya iniciada no se
 * toca). `AUTO_START_INTERVAL_SECONDS=0` lo apaga (los tests lo lanzan a mano).
 */
@Injectable()
export class SessionAutoStarter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionAutoStarter.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(SESSION_RECORD_REPOSITORY) private readonly sessionRecords: SessionRecordRepository,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalSeconds = Number(
      this.config.get('AUTO_START_INTERVAL_SECONDS') ?? DEFAULT_AUTO_START_INTERVAL_SECONDS,
    );
    if (intervalSeconds <= 0) return;
    this.timer = setInterval(() => {
      this.startDueSessions().catch((error: unknown) => {
        this.logger.error('The automatic start of sessions failed', error);
      });
    }, intervalSeconds * MILLISECONDS_PER_SECOND);
    // No retiene el proceso al apagar: Nest lo para en `onModuleDestroy`.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Las citas de los centros con inicio automático que ya han llegado a su hora. */
  async startDueSessions(now: Date = new Date()): Promise<void> {
    const centerIds = await this.sessionRecords.findCentersWithAutoStart();
    for (const centerId of centerIds) {
      const systemActor: ActorContext = {
        userId: '',
        centerId,
        membershipId: '',
        role: 'owner',
        permissions: [],
      };
      try {
        await this.sessionRecords.startDueSessions(systemActor, { now });
      } catch (error) {
        this.logger.error('Could not start the due sessions of a center', error);
      }
    }
  }
}
