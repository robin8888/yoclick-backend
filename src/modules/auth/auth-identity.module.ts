import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PasswordHasher } from '../../shared/auth/password-hasher';
import { SecretEncryptor } from '../../shared/crypto/secret-encryptor';
import { type Environment } from '../../shared/config/environment.schema';
import { ChangePasswordUseCase } from './application/change-password.use-case';
import { ReauthenticationChecker } from './application/reauthentication.checker';
import { AccountSecurityNotifier } from './application/account-security-notifier';
import { LoginUseCase } from './application/login.use-case';
import { LogoutUseCase } from './application/logout.use-case';
import { AccountPasswordChanger } from './application/account-password-changer';
import { ForgotPasswordUseCase } from './application/forgot-password.use-case';
import { PasswordAcceptabilityChecker } from './application/password-acceptability.checker';
import {
  BREACHED_PASSWORD_CHECKER,
  type BreachedPasswordChecker,
} from './application/ports/breached-password.checker';
import { SESSION_REPOSITORY } from './application/ports/session.repository';
import { USER_ACCOUNT_REPOSITORY } from './application/ports/user-account.repository';
import { VERIFICATION_CODE_HASHER } from './application/ports/verification-code.hasher';
import { VERIFICATION_CODE_REPOSITORY } from './application/ports/verification-code.repository';
import { ResetPasswordUseCase } from './application/reset-password.use-case';
import { RefreshSessionUseCase } from './application/refresh-session.use-case';
import { RegisterUserUseCase } from './application/register-user.use-case';
import { RegistrationEligibilityChecker } from './application/registration-eligibility.checker';
import { ResendEmailVerificationUseCase } from './application/resend-email-verification.use-case';
import { SessionIssuer } from './application/session-issuer';
import { VerificationCodeChecker } from './application/verification-code-checker';
import { VerificationCodeIssuer } from './application/verification-code-issuer';
import { VerifyEmailUseCase } from './application/verify-email.use-case';
import { ConfirmTotpUseCase } from './application/confirm-totp.use-case';
import { DisableMfaUseCase } from './application/disable-mfa.use-case';
import { GetMfaStatusUseCase } from './application/get-mfa-status.use-case';
import { LoginFailureRecorder } from './application/login-failure-recorder';
import { MfaActivator } from './application/mfa-activator';
import { MFA_REPOSITORY } from './application/ports/mfa.repository';
import { RecoveryCodeService } from './application/recovery-code-service';
import { RegenerateRecoveryCodesUseCase } from './application/regenerate-recovery-codes.use-case';
import { SecondFactorVerifier } from './application/second-factor-verifier';
import { SetupTotpUseCase } from './application/setup-totp.use-case';
import { VerifyMfaLoginUseCase } from './application/verify-mfa-login.use-case';
import { MfaController } from './http/mfa.controller';
import { PrismaMfaRepository } from './infrastructure/prisma-mfa.repository';
import { TotpEngine } from './infrastructure/totp-engine';
import { PasswordController } from './http/password.controller';
import { RegistrationController } from './http/registration.controller';
import { SessionController } from './http/session.controller';
import { OpenSessionsController } from './http/open-sessions.controller';
import {
  ListOpenSessionsUseCase,
  RevokeOpenSessionUseCase,
} from './application/open-sessions.use-cases';
import { ClientAddressHasher } from './infrastructure/client-address.hasher';
import { DisabledBreachedPasswordChecker } from './infrastructure/disabled-breached-password.checker';
import { HmacVerificationCodeHasher } from './infrastructure/hmac-verification-code.hasher';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserAccountRepository } from './infrastructure/prisma-user-account.repository';
import { PrismaVerificationCodeRepository } from './infrastructure/prisma-verification-code.repository';
import { PwnedPasswordsChecker } from './infrastructure/pwned-passwords.checker';

@Module({
  controllers: [
    RegistrationController,
    SessionController,
    OpenSessionsController,
    PasswordController,
    MfaController,
  ],
  providers: [
    PasswordHasher,
    SecretEncryptor,
    TotpEngine,
    RecoveryCodeService,
    SecondFactorVerifier,
    MfaActivator,
    LoginFailureRecorder,
    SetupTotpUseCase,
    ConfirmTotpUseCase,
    DisableMfaUseCase,
    RegenerateRecoveryCodesUseCase,
    GetMfaStatusUseCase,
    VerifyMfaLoginUseCase,
    ClientAddressHasher,
    PasswordAcceptabilityChecker,
    RegistrationEligibilityChecker,
    VerificationCodeChecker,
    VerificationCodeIssuer,
    SessionIssuer,
    AccountSecurityNotifier,
    LoginUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    ListOpenSessionsUseCase,
    RevokeOpenSessionUseCase,
    AccountPasswordChanger,
    ReauthenticationChecker,
    ChangePasswordUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    RegisterUserUseCase,
    VerifyEmailUseCase,
    ResendEmailVerificationUseCase,
    { provide: USER_ACCOUNT_REPOSITORY, useClass: PrismaUserAccountRepository },
    { provide: MFA_REPOSITORY, useClass: PrismaMfaRepository },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: VERIFICATION_CODE_REPOSITORY, useClass: PrismaVerificationCodeRepository },
    { provide: VERIFICATION_CODE_HASHER, useClass: HmacVerificationCodeHasher },
    {
      provide: BREACHED_PASSWORD_CHECKER,
      inject: [ConfigService, PinoLogger],
      useFactory: (
        configService: ConfigService<Environment, true>,
        logger: PinoLogger,
      ): BreachedPasswordChecker =>
        configService.get('PASSWORD_BREACH_CHECK', { infer: true }) === 'enabled'
          ? new PwnedPasswordsChecker(logger)
          : new DisabledBreachedPasswordChecker(),
    },
  ],
  // Lo que el módulo `me` necesita de identidad: reautenticar, cambiar la contraseña y cerrar sesiones.
  exports: [ReauthenticationChecker, ChangePasswordUseCase, SESSION_REPOSITORY],
})
export class AuthIdentityModule {}
