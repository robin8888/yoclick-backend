import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type AuthenticatedLogin, LoginUseCase } from '../application/login.use-case';
import { LogoutUseCase } from '../application/logout.use-case';
import { RefreshSessionUseCase } from '../application/refresh-session.use-case';
import { type SessionTokens } from '../application/session-issuer';
import { SendLoginEmailCodeUseCase } from '../application/send-email-second-factor-code.use-cases';
import { VerifyMfaLoginUseCase } from '../application/verify-mfa-login.use-case';
import { LoginRequestDto } from './dto/login-request.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { MfaVerifyRequestDto } from './dto/mfa-verify-request.dto';
import { EmailCodeSentResponseDto } from './dto/mfa-management-dtos';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import {
  MfaEmailSendRequestDto,
  MfaChallengeResponseDto,
  MfaLoginResponseDto,
  RefreshResponseDto,
} from './dto/session-response.dto';

function serializeTokens(session: SessionTokens): {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
} {
  return {
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
  };
}

function serializeAuthenticatedLogin(login: AuthenticatedLogin): Record<string, unknown> {
  return { status: 'authenticated', ...serializeTokens(login), user: login.user };
}

@ApiTags('auth')
@ApiExtraModels(MfaLoginResponseDto, MfaChallengeResponseDto)
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('auth')
export class SessionController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly verifyMfaLogin: VerifyMfaLoginUseCase,
    private readonly sendLoginEmailCode: SendLoginEmailCodeUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase,
  ) {}

  @Post('login')
  @Throttle({ default: RATE_LIMITS.login })
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auth_login',
    summary:
      'Inicia sesión con correo y contraseña. Un correo inexistente, una contraseña errónea y una cuenta bloqueada responden igual. Con segundo factor activo devuelve un desafío (`status: mfa_required`) en lugar de la sesión.',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(MfaLoginResponseDto) },
        { $ref: getSchemaPath(MfaChallengeResponseDto) },
      ],
    },
  })
  async login(@Body() body: LoginRequestDto): Promise<Record<string, unknown>> {
    const result = await this.loginUseCase.execute({
      email: body.email,
      password: body.password,
      deviceName: body.deviceName ?? null,
    });
    if (result.kind === 'mfa_required') {
      return {
        status: 'mfa_required',
        mfaToken: result.mfaToken,
        mfaTokenExpiresAt: result.mfaTokenExpiresAt.toISOString(),
        methods: result.methods,
        emailHint: result.emailHint,
      };
    }
    return serializeAuthenticatedLogin(result);
  }

  @Post('mfa/verify')
  @Throttle({ default: RATE_LIMITS.submitCode })
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auth_verify_mfa',
    summary:
      'Completa el inicio de sesión con el código de la app (`code`), el recibido por correo (`emailCode`) o un código de recuperación (`recoveryCode`): exactamente uno. Cada código sirve una sola vez; el de correo caduca a los 10 minutos y se invalida tras 5 fallos.',
  })
  @ApiOkResponse({ type: MfaLoginResponseDto })
  async verifyMfa(@Body() body: MfaVerifyRequestDto): Promise<Record<string, unknown>> {
    const login = await this.verifyMfaLogin.execute({
      mfaToken: body.mfaToken,
      code: body.code,
      emailCode: body.emailCode,
      recoveryCode: body.recoveryCode,
      deviceName: body.deviceName ?? null,
    });
    return serializeAuthenticatedLogin(login);
  }

  @Post('mfa/email/send')
  @Throttle({ default: RATE_LIMITS.sendEmailCode })
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auth_send_mfa_email_code',
    summary:
      'Envía al correo de la persona el código de 6 dígitos del segundo factor (caduca a los 10 minutos). Pide el desafío `mfaToken` del login. 429 RATE_LIMITED si se pidió otro hace menos de 60 s; 409 MFA_NOT_ENABLED; 401 si el desafío no es válido.',
  })
  @ApiOkResponse({ type: EmailCodeSentResponseDto })
  async sendMfaEmailCode(@Body() body: MfaEmailSendRequestDto): Promise<Record<string, unknown>> {
    const sent = await this.sendLoginEmailCode.execute(body.mfaToken);
    return { emailHint: sent.emailHint, codeExpiresAt: sent.codeExpiresAt.toISOString() };
  }

  @Post('refresh')
  @Throttle({ default: RATE_LIMITS.refreshSession })
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auth_refresh',
    summary:
      'Rota el refresh token y devuelve tokens nuevos. Reutilizar un token ya rotado revoca toda la sesión de ese dispositivo. Conserva el nivel de autenticación de la sesión (con o sin segundo factor).',
  })
  @ApiOkResponse({ type: RefreshResponseDto })
  async refresh(@Body() body: RefreshRequestDto): Promise<Record<string, unknown>> {
    const session = await this.refreshSession.execute({
      refreshToken: body.refreshToken,
      deviceName: body.deviceName ?? null,
    });
    return serializeTokens(session);
  }

  @Post('logout')
  @UserScoped()
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'auth_logout',
    summary: 'Cierra la sesión de este dispositivo, o de todos con `everywhere`.',
  })
  @ApiNoContentResponse()
  async logout(@CurrentUserId() userId: string, @Body() body: LogoutRequestDto): Promise<void> {
    await this.logoutUseCase.execute({
      userId,
      refreshToken: body.refreshToken ?? null,
      everywhere: body.everywhere,
    });
  }
}
