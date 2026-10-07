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
import { ActivityRecorder } from '../../activity/application/activity-recorder';
import { type ClientDataExport } from '../application/ports/privacy-request.repository';
import { ExportClientDataUseCase } from '../application/privacy-request.use-cases';
import {
  ClientDataExportParamsDto,
  ClientDataExportRequestDto,
  ClientDataExportResponseDto,
} from './privacy-request.dto';

function serializeExport(exported: ClientDataExport): Record<string, unknown> {
  return {
    ...exported,
    exportedAt: exported.exportedAt.toISOString(),
    membership: { ...exported.membership, joinedAt: exported.membership.joinedAt.toISOString() },
    bookings: exported.bookings.map((booking) => ({
      ...booking,
      startsAt: booking.startsAt.toISOString(),
      checkedInAt: booking.checkedInAt?.toISOString() ?? null,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    })),
    routines: exported.routines.map((routine) => ({
      ...routine,
      assignedAt: routine.assignedAt.toISOString(),
    })),
    privacyRequests: exported.privacyRequests.map((request) => ({
      ...request,
      createdAt: request.createdAt.toISOString(),
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
    })),
  };
}

/** Responder a un derecho de acceso: todo lo que el centro guarda de una persona, en JSON. */
@ApiTags('privacy')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/clients/:membershipId/data-export')
@Throttle({ default: RATE_LIMITS.accountSecurity })
export class ClientDataExportController {
  constructor(
    private readonly exportClientData: ExportClientDataUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Post()
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'privacy_export_client_data',
    summary:
      'Exporta lo que el centro guarda de una persona (RGPD art. 15): datos, citas, rutinas y solicitudes. Pide la contraseña de quien exporta y queda anotado.',
  })
  @ApiOkResponse({ type: ClientDataExportResponseDto })
  async export(
    @CurrentActor() actor: ActorContext,
    @Param() params: ClientDataExportParamsDto,
    @Body() body: ClientDataExportRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const exported = await this.exportClientData.execute({
      actor,
      clientMembershipId: params.membershipId,
      password: body.password,
    });
    await this.activity.record(actor, {
      kind: 'client_data_exported',
      subject: exported.person.fullName,
    });
    return serializeExport(exported);
  }
}
