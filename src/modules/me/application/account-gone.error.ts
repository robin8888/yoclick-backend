import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';

/** Una cuenta eliminada con un token aún vigente (hasta 10 minutos) deja de existir para la API. */
export function accountGoneError(): DomainError {
  return new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);
}
