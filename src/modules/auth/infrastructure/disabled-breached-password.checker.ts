import { Injectable } from '@nestjs/common';
import { type BreachedPasswordChecker } from '../application/ports/breached-password.checker';

/** Para trabajar sin conexión (`PASSWORD_BREACH_CHECK=disabled`). En producción la configuración lo impide. */
@Injectable()
export class DisabledBreachedPasswordChecker implements BreachedPasswordChecker {
  isBreached(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
