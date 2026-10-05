import { Inject, Injectable } from '@nestjs/common';
import { AccessTokenService } from '../../../shared/auth/access-token.service';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { buildCheckInQrContent, extractCheckInToken } from '../domain/check-in';
import {
  CHECK_IN_REPOSITORY,
  type CheckInRepository,
  type CheckInOutcome,
} from './ports/check-in.repository';

export interface IssuedCheckInCode {
  readonly qrContent: string;
  readonly expiresAt: Date;
}

type CompletedCheckIn = Extract<CheckInOutcome, { kind: 'checked_in' | 'already_checked_in' }>;

function invalidCodeError(): DomainError {
  return new DomainError('CHECKIN_CODE_INVALID', HTTP_STATUS.unprocessableEntity);
}

/** El QR de asistencia de quien lo pide: el servidor lo firma con su membresía y su centro. */
@Injectable()
export class IssueCheckInCodeUseCase {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async execute(actor: ActorContext): Promise<IssuedCheckInCode> {
    const issued = await this.accessTokens.issueCheckinToken({
      membershipId: actor.membershipId,
      centerId: actor.centerId,
    });
    return { qrContent: buildCheckInQrContent(issued.token), expiresAt: issued.expiresAt };
  }
}

@Injectable()
export class CheckInClientUseCase {
  constructor(
    private readonly accessTokens: AccessTokenService,
    @Inject(CHECK_IN_REPOSITORY) private readonly checkIns: CheckInRepository,
  ) {}

  async execute(input: {
    actor: ActorContext;
    qrContent: string;
    now: Date;
  }): Promise<CompletedCheckIn> {
    const token = extractCheckInToken(input.qrContent);
    if (token === null) throw invalidCodeError();
    const claims = await this.accessTokens.verifyCheckinToken(token);
    // Un código de otro centro es indistinguible de uno falso.
    if (claims.centerId !== input.actor.centerId) throw invalidCodeError();

    const outcome = await this.checkIns.checkInClient(input.actor, {
      clientMembershipId: claims.membershipId,
      now: input.now,
    });
    if (outcome.kind === 'invalid_client') throw invalidCodeError();
    if (outcome.kind === 'no_booking') {
      throw new DomainError('CHECKIN_NO_BOOKING', HTTP_STATUS.conflict);
    }
    return outcome;
  }
}
