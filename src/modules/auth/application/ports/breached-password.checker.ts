/** ¿Aparece esta contraseña en filtraciones públicas conocidas? (SEC-43) */
export interface BreachedPasswordChecker {
  isBreached(plainPassword: string): Promise<boolean>;
}

export const BREACHED_PASSWORD_CHECKER = Symbol('BREACHED_PASSWORD_CHECKER');
