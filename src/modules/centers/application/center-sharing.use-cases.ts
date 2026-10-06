import { Inject, Injectable } from '@nestjs/common';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { generateJoinCode } from '../../onboarding/domain/center-identifiers';
import {
  CENTER_SHARING_REPOSITORY,
  type CenterSharingRepository,
  type JoinStats,
} from './ports/center-sharing.repository';

const MAX_CODE_ATTEMPTS = 10;

@Injectable()
export class GetJoinStatsUseCase {
  constructor(
    @Inject(CENTER_SHARING_REPOSITORY) private readonly sharing: CenterSharingRepository,
  ) {}

  execute(actor: ActorContext): Promise<JoinStats> {
    return this.sharing.countJoinsThisMonth(actor, new Date());
  }
}

/**
 * Cambia el código de unión: el QR y el enlace anteriores dejan de funcionar, y quien ya se unió no
 * se ve afectado. Si el código sorteado ya es de otro centro, se sortea otro.
 */
@Injectable()
export class RegenerateJoinCodeUseCase {
  constructor(
    @Inject(CENTER_SHARING_REPOSITORY) private readonly sharing: CenterSharingRepository,
  ) {}

  async execute(actor: ActorContext): Promise<string> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const joinCode = generateJoinCode();
      if ((await this.sharing.replaceJoinCode(actor, joinCode)) === 'replaced') return joinCode;
    }
    throw new Error('Could not find a free join code');
  }
}
