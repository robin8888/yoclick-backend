import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { type BookingView } from '../../bookings/application/ports/booking.repository';
import {
  type ConfirmOfferOutcome,
  type SessionWaitlistPersonView,
  WAITLIST_REPOSITORY,
  type WaitlistEntryView,
  type WaitlistRepository,
} from './ports/waitlist.repository';

/**
 * Pone al día la espera de un centro y avisa a quien reciba una plaza. Se llama después de cualquier
 * acción que libera una plaza (cancelar, mover una cita) y desde el barrido que caduca las ofertas.
 * Nunca rompe la acción que lo provoca: si falla, el siguiente barrido lo repite.
 */
@Injectable()
export class WaitlistAdvancer {
  private readonly logger = new Logger(WaitlistAdvancer.name);

  constructor(
    @Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository,
    private readonly push: PushDispatcher,
  ) {}

  async advanceCenter(actor: ActorContext, now: Date = new Date()): Promise<void> {
    try {
      await this.waitlist.advanceCenter(actor, { now });
      await this.push.flushCenter(actor);
    } catch (error) {
      this.logger.error('Could not advance the waitlist of a center', error);
    }
  }

  /** Los centros con ofertas vencidas: la plaza pasa a la siguiente persona y se avisa. */
  async sweepExpiredOffers(now: Date = new Date()): Promise<void> {
    const centerIds = await this.waitlist.findCentersWithExpiredOffers({ now });
    for (const centerId of centerIds) {
      const systemActor: ActorContext = {
        userId: '',
        centerId,
        membershipId: '',
        role: 'owner',
        permissions: [],
      };
      await this.advanceCenter(systemActor, now);
    }
  }
}

@Injectable()
export class JoinWaitlistUseCase {
  constructor(@Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository) {}

  async execute(
    actor: ActorContext,
    command: { classSessionId: string; now: Date },
  ): Promise<WaitlistEntryView> {
    const outcome = await this.waitlist.join(actor, command);
    if (outcome.kind === 'joined') return outcome.entry;
    if (outcome.kind === 'session_has_seats') {
      throw new DomainError('WAITLIST_SESSION_HAS_SEATS', HTTP_STATUS.conflict);
    }
    if (outcome.kind === 'already_booked') {
      throw new DomainError('ALREADY_BOOKED', HTTP_STATUS.conflict);
    }
    if (outcome.kind === 'already_waiting') {
      throw new DomainError('WAITLIST_ALREADY_JOINED', HTTP_STATUS.conflict);
    }
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

/** Salir de la espera; si ya tenía una plaza ofrecida, esa plaza pasa a la siguiente persona. */
@Injectable()
export class LeaveWaitlistUseCase {
  constructor(
    @Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository,
    private readonly advancer: WaitlistAdvancer,
  ) {}

  async execute(actor: ActorContext, command: { entryId: string }): Promise<void> {
    const result = await this.waitlist.leave(actor, command);
    if (!result.wasFound) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (result.hadOffer) await this.advancer.advanceCenter(actor);
  }
}

/** El personal quita a alguien de la espera; si tenía la plaza ofrecida, pasa a la siguiente persona. */
@Injectable()
export class RemoveFromSessionWaitlistUseCase {
  constructor(
    @Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository,
    private readonly advancer: WaitlistAdvancer,
  ) {}

  async execute(
    actor: ActorContext,
    command: { entryId: string; classSessionId: string },
  ): Promise<void> {
    const result = await this.waitlist.removeFromSession(actor, command);
    if (!result.wasFound) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (result.hadOffer) await this.advancer.advanceCenter(actor);
  }
}

@Injectable()
export class ListMyWaitlistUseCase {
  constructor(@Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository) {}

  execute(actor: ActorContext, query: { now: Date }): Promise<WaitlistEntryView[]> {
    return this.waitlist.listMine(actor, query);
  }
}

@Injectable()
export class ListSessionWaitlistUseCase {
  constructor(@Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository) {}

  execute(
    actor: ActorContext,
    query: { classSessionId: string; now: Date },
  ): Promise<SessionWaitlistPersonView[]> {
    return this.waitlist.listForSession(actor, query);
  }
}

const REFUSALS_BY_REASON: Readonly<
  Record<
    Extract<ConfirmOfferOutcome, { kind: 'refused' }>['reason'],
    ConstructorParameters<typeof DomainError>
  >
> = {
  client_not_found: ['NOT_FOUND', HTTP_STATUS.notFound],
  session_not_found: ['NOT_FOUND', HTTP_STATUS.notFound],
  session_full: ['SESSION_FULL', HTTP_STATUS.conflict],
  already_booked: ['ALREADY_BOOKED', HTTP_STATUS.conflict],
  outside_window: ['OUTSIDE_BOOKING_WINDOW', HTTP_STATUS.conflict],
  pass_fully_booked: ['PASS_FULLY_BOOKED', HTTP_STATUS.conflict],
  pass_required: ['PASS_NEEDED_TO_BOOK', HTTP_STATUS.conflict],
  client_has_no_pass: ['CLIENT_HAS_NO_PASS', HTTP_STATUS.conflict],
};

/** Confirmar la plaza ofrecida: se crea la reserva como si la persona se hubiera apuntado a la clase. */
@Injectable()
export class ConfirmWaitlistOfferUseCase {
  constructor(@Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository) {}

  async execute(
    actor: ActorContext,
    command: { entryId: string; now: Date },
  ): Promise<BookingView> {
    const outcome = await this.waitlist.confirm(actor, command);
    if (outcome.kind === 'confirmed') return outcome.booking;
    if (outcome.kind === 'offer_expired') {
      throw new DomainError('WAITLIST_OFFER_EXPIRED', HTTP_STATUS.conflict);
    }
    if (outcome.kind === 'refused') throw new DomainError(...REFUSALS_BY_REASON[outcome.reason]);
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
