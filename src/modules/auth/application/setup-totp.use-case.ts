import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { SecretEncryptor } from '../../../shared/crypto/secret-encryptor';
import { TotpEngine } from '../infrastructure/totp-engine';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
import { ReauthenticationChecker } from './reauthentication.checker';

export interface TotpSetup {
  /** El secreto en base32, para quien prefiera teclearlo en lugar de escanear el QR. Se enseña UNA vez. */
  readonly secret: string;
  /** El URI `otpauth://` que la app convierte en QR. */
  readonly provisioningUri: string;
}

/**
 * Empieza a configurar el segundo factor. Exige la contraseña (SEC-12). El secreto se guarda CIFRADO y
 * sin confirmar: no cuenta ni se exige hasta que la persona demuestre, con un primer código, que su
 * aplicación lo ha recibido bien (así nadie se queda fuera de su cuenta por un QR mal escaneado).
 */
@Injectable()
export class SetupTotpUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
    private readonly totpEngine: TotpEngine,
    private readonly secretEncryptor: SecretEncryptor,
  ) {}

  async execute(userId: string, password: string): Promise<TotpSetup> {
    const account = await this.reauthenticationChecker.assertPasswordIsCorrect(userId, password);

    const secret = this.totpEngine.generateSecret();
    const wasSaved = await this.mfa.saveUnconfirmedFactor(
      userId,
      this.secretEncryptor.encrypt(secret),
    );
    if (!wasSaved) throw new DomainError('MFA_ALREADY_ENABLED', HTTP_STATUS.conflict);

    return {
      secret,
      provisioningUri: this.totpEngine.buildProvisioningUri({
        secret,
        accountName: account.email,
      }),
    };
  }
}
