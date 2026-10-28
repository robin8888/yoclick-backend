import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import { ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type FastifyRequest } from 'fastify';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { HandleVoiceCallEndUseCase } from '../application/handle-voice-call-end.use-case';
import { HandleVoiceToolUseCase } from '../application/handle-voice-tool.use-case';
import {
  VOICE_AGENT_PROVIDER,
  type VoiceAgentProvider,
} from '../application/ports/voice-agent-provider';
import { type VoiceToolName } from '../application/voice-tool-schemas';
import { VoiceWebhookBodyDto, VoiceWebhookResponseDto } from './voice-receptionist.dto';

/**
 * Avisos del agente de voz (Vapi). Rutas públicas: la puerta es el secreto compartido del proveedor, que se
 * comprueba antes de leer nada. El centro NUNCA viene en el cuerpo: se decide por el número puente al que se
 * llamó. Todas contestan 200 con el resultado para el bot; un rechazo de negocio no es un error HTTP.
 */
@ApiTags('voice-receptionist')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('webhooks/voice')
@Throttle({ default: RATE_LIMITS.voiceWebhook })
export class VoiceWebhooksController {
  constructor(
    @Inject(VOICE_AGENT_PROVIDER) private readonly provider: VoiceAgentProvider,
    private readonly handleTool: HandleVoiceToolUseCase,
    private readonly handleCallEnd: HandleVoiceCallEndUseCase,
  ) {}

  @Post('available-sessions')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_tool_get_available_sessions',
    summary:
      'Herramienta del agente: servicios que se pueden reservar y, de uno, sus horas libres o clases con plaza.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  availableSessions(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    return this.runTool('getAvailableSessions', request, body);
  }

  @Post('identify-caller')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_tool_identify_caller',
    summary:
      'Herramienta del agente: identifica a quien llama por su código de 6 cifras. Tras 3 fallos pide pasar a una persona.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  identifyCaller(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    return this.runTool('identifyCaller', request, body);
  }

  @Post('caller-bookings')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_tool_get_caller_bookings',
    summary: 'Herramienta del agente: las próximas citas de quien llama.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  callerBookings(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    return this.runTool('getCallerBookings', request, body);
  }

  @Post('bookings')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_tool_create_booking',
    summary:
      'Herramienta del agente: reserva con las mismas reglas que la app. Quien no es alumno ni cliente queda como invitado. Idempotente por llamada y orden.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  createBooking(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    return this.runTool('createBookingForCaller', request, body);
  }

  @Post('bookings/cancel')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_tool_cancel_booking',
    summary: 'Herramienta del agente: cancela una cita de quien llama.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  cancelBooking(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    return this.runTool('cancelBookingForCaller', request, body);
  }

  @Post('bookings/reschedule')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_tool_reschedule_booking',
    summary: 'Herramienta del agente: cambia de hora una cita de quien llama.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  rescheduleBooking(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    return this.runTool('rescheduleBookingForCaller', request, body);
  }

  @Post('waitlist')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_tool_add_to_waitlist',
    summary:
      'Herramienta del agente: apunta a quien llama a la lista de espera de una clase llena (planes Pro y Premium).',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  addToWaitlist(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    return this.runTool('addCallerToWaitlist', request, body);
  }

  @Post('transfer')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_tool_transfer_call',
    summary: 'Herramienta del agente: pasa la llamada a una persona del centro.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  transferCall(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    return this.runTool('transferCallToHuman', request, body);
  }

  @Post('transfer-destination')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_transfer_destination',
    summary:
      'Petición del proveedor para saber a quién pasar la llamada (herramienta nativa de transferencia sin destino fijo): responde con el teléfono de la persona del centro o con un rechazo.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  async transferDestination(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    this.assertAuthentic(request);
    return this.answerTransferDestination(body);
  }

  @Post('events')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_server_events',
    summary:
      'URL única del servidor del asistente: reparte por tipo de aviso entre el informe de fin de llamada y la petición de destino de una transferencia. Cualquier otro tipo se ignora con 200.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  async serverEvents(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    this.assertAuthentic(request);
    const kind = this.provider.readServerMessageKind(body);
    if (kind === 'end-of-call') return this.recordCallEnd(body);
    if (kind === 'transfer-destination') return this.answerTransferDestination(body);
    return {};
  }

  @Post('end-of-call')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'voice_end_of_call',
    summary:
      'Informe de fin de llamada: guarda duración, resumen y transcripción y suma los minutos del periodo.',
  })
  @ApiOkResponse({ type: VoiceWebhookResponseDto })
  async endOfCall(
    @Req() request: FastifyRequest,
    @Body() body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    this.assertAuthentic(request);
    return this.recordCallEnd(body);
  }

  private async recordCallEnd(body: VoiceWebhookBodyDto): Promise<Record<string, unknown>> {
    const callEnd = this.provider.parseCallEnd(body);
    if (callEnd === null) throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    const { isAccepted } = await this.handleCallEnd.execute(callEnd);
    return { isAccepted };
  }

  private async answerTransferDestination(
    body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    const invocation = this.provider.parseTransferDestinationRequest(body);
    if (invocation === null) throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    const reply = await this.handleTool.execute('transferCallToHuman', invocation);
    return this.provider.buildTransferDestinationResponse(reply);
  }

  private async runTool(
    toolName: VoiceToolName,
    request: FastifyRequest,
    body: VoiceWebhookBodyDto,
  ): Promise<Record<string, unknown>> {
    this.assertAuthentic(request);
    const invocation = this.provider.parseToolInvocation(body);
    if (invocation === null) throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    const reply = await this.handleTool.execute(toolName, invocation);
    return this.provider.buildToolResponse(invocation.toolCallId, reply);
  }

  private assertAuthentic(request: FastifyRequest): void {
    if (!this.provider.isWebhookAuthentic(request.headers)) {
      throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);
    }
  }
}
