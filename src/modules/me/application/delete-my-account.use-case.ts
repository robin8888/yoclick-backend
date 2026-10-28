import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { CloseCenterUseCase } from '../../billing/application/close-center.use-case';
import { PhotoFileKeeper } from '../../photos/application/photo-file-keeper';
import { ReauthenticationChecker } from '../../auth/application/reauthentication.checker';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../../auth/application/ports/session.repository';
import {
  ACCOUNT_ERASURE_REPOSITORY,
  type AccountErasureRepository,
} from './ports/account-erasure.repository';

export interface DeleteMyAccountInput {
  readonly userId: string;
  readonly password: string;
  /** La persona acepta cerrar los centros de los que es la única propietaria. */
  readonly closeOwnedCenters: boolean;
}

/**
 * Elimina la cuenta dentro de la app (Apple 5.1.1(v), RGPD art. 17). Exige la contraseña, y la
 * confirmación escrita la pide ya la capa HTTP.
 *
 * Quien es la única propietaria de un centro no puede dejarlo sin responsable. Si acepta cerrarlo
 * (`closeOwnedCenters`), el centro se cierra en este mismo paso, antes de borrar la cuenta; si no, se
 * le dice que debe confirmarlo. Si hay otro propietario, el centro sigue abierto.
 */
@Injectable()
export class DeleteMyAccountUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    @Inject(ACCOUNT_ERASURE_REPOSITORY) private readonly erasure: AccountErasureRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    private readonly photoFiles: PhotoFileKeeper,
    private readonly closeCenter: CloseCenterUseCase,
  ) {}

  async execute(input: DeleteMyAccountInput): Promise<void> {
    const { userId } = input;
    await this.reauthenticationChecker.assertPasswordIsCorrect(userId, input.password);
    await this.closeOwnedCentersIfConfirmed(input);

    const now = new Date();
    // Primero se cierran las sesiones: si el borrado fallara a medias, nadie sigue dentro con la cuenta.
    await this.sessions.revokeAllOfUser(userId, now);
    await this.photoFiles.discard(await this.erasure.anonymize(userId, now));
  }

  /** Cerrar es idempotente: si algo falla a medias, repetir el borrado termina lo que faltaba. */
  private async closeOwnedCentersIfConfirmed(input: DeleteMyAccountInput): Promise<void> {
    const ownedCenters = await this.closeCenter.listCentersSolelyOwnedBy(input.userId);
    if (ownedCenters.length === 0) return;
    if (!input.closeOwnedCenters) {
      throw new DomainError('ACCOUNT_OWNS_CENTER', HTTP_STATUS.conflict);
    }
    for (const { centerId } of ownedCenters) {
      await this.closeCenter.execute({ centerId, closedByUserId: input.userId });
    }
  }
}
