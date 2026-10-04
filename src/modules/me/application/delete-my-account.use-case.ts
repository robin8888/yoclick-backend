import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ReauthenticationChecker } from '../../auth/application/reauthentication.checker';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../../auth/application/ports/session.repository';
import {
  ACCOUNT_ERASURE_REPOSITORY,
  type AccountErasureRepository,
} from './ports/account-erasure.repository';

/**
 * Elimina la cuenta dentro de la app (Apple 5.1.1(v), RGPD art. 17). Exige la contraseña, y la
 * confirmación escrita la pide ya la capa HTTP.
 *
 * Una propietaria de un centro activo no puede eliminarse sin más: dejaría a sus clientes y a su
 * suscripción sin responsable. Primero tiene que traspasarlo o cerrarlo.
 */
@Injectable()
export class DeleteMyAccountUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    @Inject(ACCOUNT_ERASURE_REPOSITORY) private readonly erasure: AccountErasureRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async execute(userId: string, password: string): Promise<void> {
    await this.reauthenticationChecker.assertPasswordIsCorrect(userId, password);

    if (await this.erasure.ownsActiveCenter(userId)) {
      throw new DomainError('ACCOUNT_OWNS_CENTER', HTTP_STATUS.conflict);
    }

    const now = new Date();
    // Primero se cierran las sesiones: si el borrado fallara a medias, nadie sigue dentro con la cuenta.
    await this.sessions.revokeAllOfUser(userId, now);
    await this.erasure.anonymize(userId, now);
  }
}
