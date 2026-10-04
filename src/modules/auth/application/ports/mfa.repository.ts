export interface MfaFactorState {
  readonly encryptedSecret: string;
  readonly isConfirmed: boolean;
  /** Último intervalo de 30 s aceptado, o `null` si nunca se ha usado. */
  readonly lastUsedStep: number | null;
}

export interface MfaConfirmation {
  /** El intervalo del primer código válido: cuenta como ya usado. */
  readonly step: number;
  readonly recoveryCodeHashes: readonly string[];
}

export interface MfaRepository {
  findFactor(userId: string): Promise<MfaFactorState | null>;
  /**
   * Guarda un factor nuevo SIN confirmar, sustituyendo uno a medio configurar. Devuelve `false` si ya hay
   * uno confirmado: no se puede pisar un segundo factor activo sin pasar por desactivarlo.
   */
  saveUnconfirmedFactor(userId: string, encryptedSecret: string): Promise<boolean>;
  /** Confirma el factor y guarda los códigos de recuperación, juntos o nada. `false` si no había nada que confirmar. */
  confirmFactor(userId: string, confirmation: MfaConfirmation): Promise<boolean>;
  /** Anti-reutilización atómica: acepta el intervalo solo si es posterior al último usado. */
  markStepUsed(userId: string, step: number): Promise<boolean>;
  /** Gasta un código de recuperación (por su hash). `false` si no existe o ya se usó. */
  consumeRecoveryCode(userId: string, codeHash: string, usedAt: Date): Promise<boolean>;
  replaceRecoveryCodes(userId: string, codeHashes: readonly string[]): Promise<void>;
  countUnusedRecoveryCodes(userId: string): Promise<number>;
  /** Elimina el factor y todos sus códigos de recuperación. */
  deleteFactor(userId: string): Promise<void>;
  /** ¿Tiene un rol de propietaria o administración activo en algún centro? Esos roles exigen segundo factor. */
  holdsAdministrativeRole(userId: string): Promise<boolean>;
}

export const MFA_REPOSITORY = Symbol('MFA_REPOSITORY');
