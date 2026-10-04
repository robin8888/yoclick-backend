export interface AccountErasureRepository {
  /** ¿Es propietaria activa de algún centro? Eliminarla dejaría el centro sin dueño. */
  ownsActiveCenter(userId: string): Promise<boolean>;
  /**
   * Borra o anonimiza todo lo personal de la cuenta, en una sola transacción: el correo pasa a una
   * dirección inválida (queda libre para volver a registrarse), el nombre a "Usuario eliminado",
   * se elimina el teléfono, la fecha de nacimiento, los códigos y las sesiones, y se sale de todos
   * los centros. Se conserva lo que la ley obliga a conservar (facturas, pruebas de consentimiento),
   * ya desvinculado de cualquier dato identificable.
   */
  anonymize(userId: string, erasedAt: Date): Promise<void>;
}

export const ACCOUNT_ERASURE_REPOSITORY = Symbol('ACCOUNT_ERASURE_REPOSITORY');
