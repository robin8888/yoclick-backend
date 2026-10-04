import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { LoginUseCase } from '../application/login.use-case';
import { LogoutUseCase } from '../application/logout.use-case';
import { RefreshSessionUseCase } from '../application/refresh-session.use-case';
import { type SessionTokens } from '../application/session-issuer';
import { LoginRequestDto } from './dto/login-request.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { LoginResponseDto, RefreshResponseDto } from './dto/session-response.dto';

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

@ApiTags('auth')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('auth')
export class SessionController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
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
      'Inicia sesión con correo y contraseña. Un correo inexistente, una contraseña errónea y una cuenta bloqueada responden igual.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(@Body() body: LoginRequestDto): Promise<unknown> {
    const result = await this.loginUseCase.execute({
      email: body.email,
      password: body.password,
      deviceName: body.deviceName ?? null,
    });
    return { ...serializeTokens(result), user: result.user };
  }

  @Post('refresh')
  @Throttle({ default: RATE_LIMITS.refreshSession })
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auth_refresh',
    summary:
      'Rota el refresh token y devuelve tokens nuevos. Reutilizar un token ya rotado revoca toda la sesión de ese dispositivo.',
  })
  @ApiOkResponse({ type: RefreshResponseDto })
  async refresh(@Body() body: RefreshRequestDto): Promise<unknown> {
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
