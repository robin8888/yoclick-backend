/** Marca una cuenta creada por una importación: ningún inicio de sesión puede coincidir con ella. */
export const UNUSABLE_PASSWORD_HASH = '!';

/**
 * Una cuenta que un centro creó al importar a sus clientes y que su dueña aún no ha reclamado. Tiene
 * el correo sin confirmar y ninguna contraseña utilizable: recibir el código de recuperación en ese
 * buzón demuestra que es suya, así que puede fijar su contraseña sin haberse registrado antes.
 */
export function isUnactivatedAccount(account: {
  readonly passwordHash: string;
  readonly emailVerifiedAt: Date | null;
}): boolean {
  return account.emailVerifiedAt === null && account.passwordHash === UNUSABLE_PASSWORD_HASH;
}

/** Quién puede pedir y usar un código de recuperación: cuentas con el correo confirmado o sin activar. */
export function canRecoverPassword(account: {
  readonly passwordHash: string;
  readonly emailVerifiedAt: Date | null;
}): boolean {
  return account.emailVerifiedAt !== null || isUnactivatedAccount(account);
}
