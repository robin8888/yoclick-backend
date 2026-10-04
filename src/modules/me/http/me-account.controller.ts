import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
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
import { ChangePasswordUseCase } from '../../auth/application/change-password.use-case';
import { DeleteMyAccountUseCase } from '../application/delete-my-account.use-case';
import { ExportMyDataUseCase } from '../application/export-my-data.use-case';
import {
  ChangePasswordRequestDto,
  DeleteAccountRequestDto,
  ExportDataRequestDto,
  PasswordChangedResponseDto,
} from './dto/account-security-dtos';
import { PersonalDataExportResponseDto } from './dto/profile-dtos';
import { serializeConsent, serializeMembership, serializeProfile } from './me.controller';

/**
 * Acciones delicadas sobre la propia cuenta. TODAS piden la contraseña otra vez (SEC-12) y están muy
 * limitadas por IP: son lo que querría hacer quien se hiciera con un token de acceso.
 */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('me')
@UserScoped()
@Throttle({ default: RATE_LIMITS.accountSecurity })
export class MeAccountController {
  constructor(
    private readonly changePassword: ChangePasswordUseCase,
    private readonly exportMyData: ExportMyDataUseCase,
    private readonly deleteMyAccount: DeleteMyAccountUseCase,
  ) {}

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'me_change_password',
    summary:
      'Cambia la contraseña (pide la actual) y cierra la sesión en todos los dispositivos, este incluido.',
  })
  @ApiOkResponse({ type: PasswordChangedResponseDto })
  async changeMyPassword(
    @CurrentUserId() userId: string,
    @Body() body: ChangePasswordRequestDto,
  ): Promise<{ status: 'password_changed' }> {
    await this.changePassword.execute({
      userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return { status: 'password_changed' };
  }

  @Post('data-export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'me_export_data',
    summary: 'Descarga todos mis datos en JSON (RGPD arts. 15 y 20). Pide la contraseña.',
  })
  @ApiOkResponse({ type: PersonalDataExportResponseDto })
  async exportData(
    @CurrentUserId() userId: string,
    @Body() body: ExportDataRequestDto,
  ): Promise<Record<string, unknown>> {
    const personalData = await this.exportMyData.execute(userId, body.password);
    return {
      exportedAt: personalData.exportedAt.toISOString(),
      profile: serializeProfile(personalData.profile),
      memberships: personalData.memberships.map(serializeMembership),
      consentHistory: personalData.consentHistory.map(serializeConsent),
    };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'me_delete_account',
    summary:
      'Elimina mi cuenta (Apple 5.1.1(v), RGPD art. 17). Pide la contraseña y escribir ELIMINAR. Irreversible.',
  })
  @ApiNoContentResponse()
  async deleteAccount(
    @CurrentUserId() userId: string,
    @Body() body: DeleteAccountRequestDto,
  ): Promise<void> {
    await this.deleteMyAccount.execute(userId, body.password);
  }
}
