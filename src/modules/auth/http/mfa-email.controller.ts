import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { ConfirmEmailMfaUseCase } from '../application/confirm-email-mfa.use-case';
import { SendAccountEmailCodeUseCase } from '../application/send-email-second-factor-code.use-cases';
import { SetupEmailMfaUseCase } from '../application/setup-email-mfa.use-case';
import {
  EmailCodeSentResponseDto,
  MfaConfirmRequestDto,
  MfaConfirmResponseDto,
  MfaSetupRequestDto,
} from './dto/mfa-management-dtos';

/**
 * Segundo factor por código enviado al correo, de la propia persona. Alta con contraseña (SEC-12) y
 * código; el envío tiene 60 s de enfriamiento por cuenta (429 RATE_LIMITED) además del límite por IP.
 */
@ApiTags('mfa')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('me/mfa/email')
@UserScoped()
@Throttle({ default: RATE_LIMITS.accountSecurity })
export class MfaEmailController {
  constructor(
    private readonly setupEmail: SetupEmailMfaUseCase,
    private readonly confirmEmail: ConfirmEmailMfaUseCase,
    private readonly sendEmailCode: SendAccountEmailCodeUseCase,
  ) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'mfa_setup_email',
    summary:
      'Empieza a activar el segundo factor por correo: pide la contraseña y envía un código de 6 dígitos al correo de la cuenta. No cuenta hasta confirmarlo. 409 MFA_ALREADY_ENABLED; 429 RATE_LIMITED si se pidió otro hace menos de 60 s.',
  })
  @ApiOkResponse({ type: EmailCodeSentResponseDto })
  async setupEmailFactor(
    @CurrentUserId() userId: string,
    @Body() body: MfaSetupRequestDto,
  ): Promise<Record<string, unknown>> {
    const setup = await this.setupEmail.execute(userId, body.password);
    return { emailHint: setup.emailHint, codeExpiresAt: setup.codeExpiresAt.toISOString() };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'mfa_confirm_email',
    summary:
      'Activa el segundo factor por correo con el primer código recibido y entrega diez códigos de recuperación (una sola vez). 403 MFA_CODE_INVALID si el código es erróneo, caducó o se agotaron sus 5 intentos.',
  })
  @ApiOkResponse({ type: MfaConfirmResponseDto })
  async confirmEmailFactor(
    @CurrentUserId() userId: string,
    @Body() body: MfaConfirmRequestDto,
  ): Promise<Record<string, unknown>> {
    return { ...(await this.confirmEmail.execute(userId, body.code)) };
  }

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'mfa_send_email_code',
    summary:
      'Con el segundo factor ya activo, envía un código por correo para usarlo en desactivar el factor o regenerar los códigos de recuperación (`emailCode`). 409 MFA_NOT_ENABLED; 429 RATE_LIMITED si se pidió otro hace menos de 60 s.',
  })
  @ApiOkResponse({ type: EmailCodeSentResponseDto })
  async sendAccountEmailCode(@CurrentUserId() userId: string): Promise<Record<string, unknown>> {
    const sent = await this.sendEmailCode.execute(userId);
    return { emailHint: sent.emailHint, codeExpiresAt: sent.codeExpiresAt.toISOString() };
  }
}
