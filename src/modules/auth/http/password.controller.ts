import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { ForgotPasswordUseCase } from '../application/forgot-password.use-case';
import { ResetPasswordUseCase } from '../application/reset-password.use-case';
import {
  ForgotPasswordRequestDto,
  PasswordChangedResponseDto,
  PasswordResetRequestedResponseDto,
  ResetPasswordRequestDto,
} from './dto/password-reset-dtos';

@ApiTags('auth')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('auth/password')
@Public()
export class PasswordController {
  constructor(
    private readonly forgotPassword: ForgotPasswordUseCase,
    private readonly resetPassword: ResetPasswordUseCase,
  ) {}

  @Post('forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'auth_forgot_password',
    summary:
      'Envía un código de 6 dígitos para cambiar la contraseña. Responde igual exista o no la cuenta.',
  })
  @ApiAcceptedResponse({ type: PasswordResetRequestedResponseDto })
  async forgot(@Body() body: ForgotPasswordRequestDto): Promise<{ status: 'reset_requested' }> {
    await this.forgotPassword.execute({ email: body.email });
    return { status: 'reset_requested' };
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auth_reset_password',
    summary:
      'Cambia la contraseña con el código (30 minutos, 5 intentos) y cierra la sesión en todos los dispositivos.',
  })
  @ApiOkResponse({ type: PasswordChangedResponseDto })
  async reset(@Body() body: ResetPasswordRequestDto): Promise<{ status: 'password_changed' }> {
    await this.resetPassword.execute({
      email: body.email,
      code: body.code,
      newPassword: body.newPassword,
    });
    return { status: 'password_changed' };
  }
}
