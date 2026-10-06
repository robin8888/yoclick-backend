import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import {
  ListOpenSessionsUseCase,
  RevokeOpenSessionUseCase,
} from '../application/open-sessions.use-cases';
import {
  ListOpenSessionsRequestDto,
  OpenSessionParamsDto,
  OpenSessionsResponseDto,
} from './dto/open-sessions.dto';

/** Sesiones abiertas de la pantalla de seguridad: los dispositivos de la persona y cerrarlos. */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@UserScoped()
@Controller('me/sessions')
export class OpenSessionsController {
  constructor(
    private readonly listOpenSessions: ListOpenSessionsUseCase,
    private readonly revokeOpenSession: RevokeOpenSessionUseCase,
  ) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'me_list_sessions',
    summary:
      'Dispositivos con sesión abierta. Se envía el refresh token de este dispositivo (nunca en la URL) para marcar cuál es esta sesión.',
  })
  @ApiOkResponse({ type: OpenSessionsResponseDto })
  async list(
    @CurrentUserId() userId: string,
    @Body() body: ListOpenSessionsRequestDto,
  ): Promise<Record<string, unknown>> {
    const sessions = await this.listOpenSessions.execute({
      userId,
      currentRefreshToken: body.refreshToken,
    });
    return {
      sessions: sessions.map((session) => ({
        ...session,
        startedAt: session.startedAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
      })),
    };
  }

  @Post(':sessionId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'me_revoke_session',
    summary:
      'Cierra la sesión de un dispositivo propio. Una sesión ajena o desconocida responde 404.',
  })
  @ApiNoContentResponse()
  async revoke(
    @CurrentUserId() userId: string,
    @Param() params: OpenSessionParamsDto,
  ): Promise<void> {
    await this.revokeOpenSession.execute(userId, params.sessionId);
  }
}
