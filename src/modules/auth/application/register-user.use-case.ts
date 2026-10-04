import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { PasswordHasher } from '../../../shared/auth/password-hasher';
import { LEGAL_DOCUMENT_VERSIONS } from '../domain/legal-document-versions';
import {
  USER_ACCOUNT_REPOSITORY,
  type NewConsent,
  type UserAccount,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { RegistrationEligibilityChecker } from './registration-eligibility.checker';
import { VerificationCodeIssuer } from './verification-code-issuer';

export interface RegisterUserCommand {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
  readonly consents: {
    readonly privacy: boolean;
    readonly terms: boolean;
    readonly marketing: boolean;
  };
  readonly clientIpHash: string | null;
}

function buildConsentRecords(consents: RegisterUserCommand['consents']): NewConsent[] {
  return [
    { kind: 'privacy', version: LEGAL_DOCUMENT_VERSIONS.privacy, isGranted: consents.privacy },
    { kind: 'terms', version: LEGAL_DOCUMENT_VERSIONS.terms, isGranted: consents.terms },
    {
      kind: 'marketing',
      version: LEGAL_DOCUMENT_VERSIONS.marketing,
      isGranted: consents.marketing,
    },
  ];
}

/**
 * Alta de una cuenta. Es deliberadamente indistinguible desde fuera si el correo ya existía o no
 * (SEC-46): en ambos casos responde igual, y lo que cambia (un código, o un aviso de "ya tienes
 * cuenta") llega solo al buzón de esa persona.
 *
 * Una segunda alta con un correo existente NUNCA modifica la cuenta ni su contraseña.
 */
@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly eligibilityChecker: RegistrationEligibilityChecker,
    private readonly codeIssuer: VerificationCodeIssuer,
  ) {}

  async execute(command: RegisterUserCommand): Promise<void> {
    await this.eligibilityChecker.assertEligible(command);
    // Se calcula el hash también si el correo ya existe: el tiempo de respuesta no delata si hay cuenta.
    const passwordHash = await this.passwordHasher.hash(command.password);

    const existingAccount = await this.users.findByEmail(command.email);
    if (existingAccount) {
      await this.notifyExistingAccount(existingAccount);
      return;
    }

    const userId = generateUuidV7();
    const creation = await this.users.create({
      id: userId,
      email: command.email,
      fullName: command.fullName,
      passwordHash,
      consents: buildConsentRecords(command.consents),
      ipHash: command.clientIpHash,
    });
    if (creation === 'created') {
      await this.codeIssuer.issue(
        { userId, email: command.email, fullName: command.fullName },
        'email_verification',
      );
      return;
    }

    // Otra petición creó la cuenta un instante antes: se trata como una cuenta ya existente.
    const winner = await this.users.findByEmail(command.email);
    if (winner) await this.notifyExistingAccount(winner);
  }

  private async notifyExistingAccount(account: UserAccount): Promise<void> {
    const recipient = { userId: account.id, email: account.email, fullName: account.fullName };
    if (account.emailVerifiedAt === null) {
      await this.codeIssuer.issue(recipient, 'email_verification');
      return;
    }
    await this.codeIssuer.sendAlreadyRegisteredNotice(recipient);
  }
}
