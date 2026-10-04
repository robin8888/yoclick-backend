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
import { VerifyMfaLoginUseCase } from '../application/verify-mfa-login.use-case';
import { LoginRequestDto } from './dto/login-request.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { MfaVerifyRequestDto } from './dto/mfa-verify-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import {
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
      'Completa el inicio de sesión con el código de la app de autenticación o un código de recuperación. Cada código de la app sirve una sola vez.',
  })
  @ApiOkResponse({ type: MfaLoginResponseDto })
  async verifyMfa(@Body() body: MfaVerifyRequestDto): Promise<Record<string, unknown>> {
    const login = await this.verifyMfaLogin.execute({
      mfaToken: body.mfaToken,
      code: body.code,
      recoveryCode: body.recoveryCode,
      deviceName: body.deviceName ?? null,
    });
    return serializeAuthenticatedLogin(login);
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
