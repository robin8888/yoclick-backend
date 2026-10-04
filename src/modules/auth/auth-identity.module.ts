import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PasswordHasher } from '../../shared/auth/password-hasher';
import { type Environment } from '../../shared/config/environment.schema';
import { PasswordAcceptabilityChecker } from './application/password-acceptability.checker';
import {
  BREACHED_PASSWORD_CHECKER,
  type BreachedPasswordChecker,
} from './application/ports/breached-password.checker';
import { USER_ACCOUNT_REPOSITORY } from './application/ports/user-account.repository';
import { VERIFICATION_CODE_HASHER } from './application/ports/verification-code.hasher';
import { VERIFICATION_CODE_REPOSITORY } from './application/ports/verification-code.repository';
import { RegisterUserUseCase } from './application/register-user.use-case';
import { RegistrationEligibilityChecker } from './application/registration-eligibility.checker';
import { ResendEmailVerificationUseCase } from './application/resend-email-verification.use-case';
import { VerificationCodeIssuer } from './application/verification-code-issuer';
import { VerifyEmailUseCase } from './application/verify-email.use-case';
import { AuthController } from './http/auth.controller';
import { ClientAddressHasher } from './infrastructure/client-address.hasher';
import { DisabledBreachedPasswordChecker } from './infrastructure/disabled-breached-password.checker';
import { HmacVerificationCodeHasher } from './infrastructure/hmac-verification-code.hasher';
import { PrismaUserAccountRepository } from './infrastructure/prisma-user-account.repository';
import { PrismaVerificationCodeRepository } from './infrastructure/prisma-verification-code.repository';
import { PwnedPasswordsChecker } from './infrastructure/pwned-passwords.checker';

@Module({
  controllers: [AuthController],
  providers: [
    PasswordHasher,
    ClientAddressHasher,
    PasswordAcceptabilityChecker,
    RegistrationEligibilityChecker,
    VerificationCodeIssuer,
    RegisterUserUseCase,
    VerifyEmailUseCase,
    ResendEmailVerificationUseCase,
    { provide: USER_ACCOUNT_REPOSITORY, useClass: PrismaUserAccountRepository },
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
})
export class AuthIdentityModule {}
