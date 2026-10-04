import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { ConfirmTotpUseCase } from '../application/confirm-totp.use-case';
import { DisableMfaUseCase } from '../application/disable-mfa.use-case';
import { GetMfaStatusUseCase } from '../application/get-mfa-status.use-case';
import { RegenerateRecoveryCodesUseCase } from '../application/regenerate-recovery-codes.use-case';
import { SetupTotpUseCase } from '../application/setup-totp.use-case';
import {
  MfaConfirmRequestDto,
  MfaConfirmResponseDto,
  MfaProofRequestDto,
  MfaSetupRequestDto,
  MfaSetupResponseDto,
  MfaStatusResponseDto,
  RegeneratedRecoveryCodesResponseDto,
} from './dto/mfa-management-dtos';

/**
 * Gestión del segundo factor de la propia persona. Activarlo, desactivarlo y regenerar los códigos de
 * recuperación piden la contraseña (SEC-12), y desactivar o regenerar piden además un código del segundo factor.
 */
@ApiTags('mfa')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('me/mfa')
@UserScoped()
@Throttle({ default: RATE_LIMITS.accountSecurity })
export class MfaController {
  constructor(
    private readonly getMfaStatus: GetMfaStatusUseCase,
    private readonly setupTotp: SetupTotpUseCase,
    private readonly confirmTotp: ConfirmTotpUseCase,
    private readonly disableMfa: DisableMfaUseCase,
    private readonly regenerateRecoveryCodes: RegenerateRecoveryCodesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'mfa_get_status',
    summary: 'Si el segundo factor está activo y cuántos códigos de recuperación quedan.',
  })
  @ApiOkResponse({ type: MfaStatusResponseDto })
  async status(@CurrentUserId() userId: string): Promise<Record<string, unknown>> {
    return { ...(await this.getMfaStatus.execute(userId)) };
  }

  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'mfa_setup_totp',
    summary:
      'Empieza a configurar la app de autenticación: devuelve el secreto y el URI para el QR. No cuenta hasta confirmarlo.',
  })
  @ApiOkResponse({ type: MfaSetupResponseDto })
  async setup(
    @CurrentUserId() userId: string,
    @Body() body: MfaSetupRequestDto,
  ): Promise<Record<string, unknown>> {
    return { ...(await this.setupTotp.execute(userId, body.password)) };
  }

  @Post('totp/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'mfa_confirm_totp',
    summary:
      'Activa el segundo factor con el primer código de la app y entrega diez códigos de recuperación (una sola vez).',
  })
  @ApiOkResponse({ type: MfaConfirmResponseDto })
  async confirm(
    @CurrentUserId() userId: string,
    @Body() body: MfaConfirmRequestDto,
  ): Promise<Record<string, unknown>> {
    return { ...(await this.confirmTotp.execute(userId, body.code)) };
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'mfa_disable',
    summary:
      'Desactiva el segundo factor. Pide la contraseña y un código. No disponible para propietarias y administradoras.',
  })
  @ApiNoContentResponse()
  async disable(@CurrentUserId() userId: string, @Body() body: MfaProofRequestDto): Promise<void> {
    await this.disableMfa.execute({
      userId,
      password: body.password,
      code: body.code,
      recoveryCode: body.recoveryCode,
    });
  }

  @Post('recovery-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'mfa_regenerate_recovery_codes',
    summary:
      'Sustituye los códigos de recuperación por diez nuevos. Pide la contraseña y un código.',
  })
  @ApiOkResponse({ type: RegeneratedRecoveryCodesResponseDto })
  async regenerate(
    @CurrentUserId() userId: string,
    @Body() body: MfaProofRequestDto,
  ): Promise<Record<string, unknown>> {
    const recoveryCodes = await this.regenerateRecoveryCodes.execute({
      userId,
      password: body.password,
      code: body.code,
      recoveryCode: body.recoveryCode,
    });
    return { recoveryCodes };
  }
}
