import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { CheckInClientUseCase, IssueCheckInCodeUseCase } from '../application/check-in.use-cases';
import { CenterRouteParamsDto } from './booking.dto';
import { CheckInCodeResponseDto, CheckInRequestDto, CheckInResponseDto } from './check-in.dto';
import { serializeBooking } from './serialize-booking';

/** Asistencia por QR: la persona clienta enseña un código firmado y quien atiende lo escanea. */
@ApiTags('attendance')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class CheckInController {
  constructor(
    private readonly issueCode: IssueCheckInCodeUseCase,
    private readonly checkInClient: CheckInClientUseCase,
  ) {}

  @Post('me/checkin-code')
  @Roles('client')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: RATE_LIMITS.issueCheckinToken })
  @ApiOperation({
    operationId: 'attendance_issue_code',
    summary:
      'El QR de asistencia de quien lo pide en este centro: un JWT firmado de 5 minutos dentro de yoclick:checkin:<jwt>. La app lo dibuja tal cual y lo renueva antes de que caduque; nunca lo construye ella.',
  })
  @ApiOkResponse({ type: CheckInCodeResponseDto })
  async issue(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<{ qrContent: string; expiresAt: string }> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const code = await this.issueCode.execute(actor);
    return { qrContent: code.qrContent, expiresAt: code.expiresAt.toISOString() };
  }

  @Post('attendance/check-in')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: RATE_LIMITS.checkInClient })
  @ApiOperation({
    operationId: 'attendance_check_in',
    summary:
      'Registra la llegada de la clienta cuyo QR se ha escaneado, en su cita confirmada de ahora (desde 60 minutos antes hasta que termina). El personal solo en las clases que atiende; administración en cualquiera. 422 CHECKIN_CODE_INVALID si el código es falso, caduco o de otro centro; 409 CHECKIN_NO_BOOKING si no tiene cita para registrar. Repetirlo devuelve la misma llegada.',
  })
  @ApiOkResponse({ type: CheckInResponseDto })
  async checkIn(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CheckInRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.checkInClient.execute({
      actor,
      qrContent: body.qrContent,
      now: new Date(),
    });
    return {
      clientFullName: outcome.clientFullName,
      checkedInAt: outcome.checkedInAt.toISOString(),
      isFirstCheckIn: outcome.kind === 'checked_in',
      booking: serializeBooking(outcome.booking),
    };
  }
}
