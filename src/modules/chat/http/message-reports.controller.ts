import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { ChatPresenter } from '../application/chat-presenter';
import {
  ListMessageReportsUseCase,
  ReportMessageUseCase,
  ReviewMessageReportUseCase,
} from '../application/chat-moderation.use-cases';
import { CenterRouteParamsDto } from './chat.dto';
import {
  MessageReportListQueryDto,
  MessageReportListResponseDto,
  MessageReportResponseDto,
  MessageReportRouteParamsDto,
  MessageRouteParamsDto,
  ReportMessageRequestDto,
  ReportMessageResponseDto,
} from './chat-moderation.dto';

/**
 * Denunciar mensajes del chat y revisar las denuncias (Apple 1.2). Una conversación entre dos personas no la lee
 * nadie más, tampoco el dueño: la única excepción es la denuncia, que lleva una copia del mensaje denunciado
 * porque quien denuncia decide compartir ese mensaje (y solo ese) con la administración.
 */
@ApiTags('chat')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class MessageReportsController {
  constructor(
    private readonly reportMessage: ReportMessageUseCase,
    private readonly listReports: ListMessageReportsUseCase,
    private readonly reviewReport: ReviewMessageReportUseCase,
    private readonly presenter: ChatPresenter,
    private readonly push: PushDispatcher,
  ) {}

  @Post('conversations/:conversationId/messages/:messageId/report')
  @Throttle({ default: RATE_LIMITS.reportMessage })
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'chat_report_message',
    summary:
      'Denuncia un mensaje de una conversación en la que participas, con un motivo y, si quieres, unas líneas. Avisa a la administración. Denunciar dos veces el mismo mensaje no duplica la denuncia. 404 si el mensaje no existe o no es tuyo; 403 CHAT_CANNOT_REPORT_OWN_MESSAGE; 429 RATE_LIMITED.',
  })
  @ApiCreatedResponse({ type: ReportMessageResponseDto })
  async report(
    @CurrentActor() actor: ActorContext,
    @Param() params: MessageRouteParamsDto,
    @Body() body: ReportMessageRequestDto,
  ): Promise<{ reportId: string; status: string }> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const created = await this.reportMessage.execute(actor, {
      conversationId: params.conversationId,
      messageId: params.messageId,
      reason: body.reason,
      details: body.details ?? null,
    });
    // El aviso al móvil es genérico y va después de guardar: nunca debe deshacer la denuncia.
    if (created.isNew) await this.push.flushCenter(actor);
    return { reportId: created.reportId, status: created.status };
  }

  @Get('message-reports')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'chat_list_message_reports',
    summary:
      'Las denuncias de mensajes del centro, de la más reciente a la más antigua (`status` filtra). Solo dueño y administración. Cada una lleva una copia del mensaje denunciado: es la única forma de leer algo de una conversación privada, y solo porque quien denuncia decidió compartirlo.',
  })
  @ApiOkResponse({ type: MessageReportListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: MessageReportListQueryDto,
  ): Promise<{ reports: Record<string, unknown>[] }> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const reports = await this.listReports.execute(actor, {
      status: query.status ?? null,
      limit: query.limit,
    });
    return { reports: reports.map((report) => this.presenter.report(report)) };
  }

  @Post('message-reports/:reportId/review')
  @HttpCode(HttpStatus.OK)
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'chat_review_message_report',
    summary:
      'Marca una denuncia como revisada. Revisar una ya revisada la deja como estaba. 404 si no existe.',
  })
  @ApiOkResponse({ type: MessageReportResponseDto })
  async review(
    @CurrentActor() actor: ActorContext,
    @Param() params: MessageReportRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return this.presenter.report(await this.reviewReport.execute(actor, params.reportId));
  }
}
