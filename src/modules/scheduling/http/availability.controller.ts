import { Controller, Get, Param, Query } from '@nestjs/common';
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
import { GetAvailabilityUseCase } from '../application/get-availability.use-case';
import {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
  CenterRouteParamsDto,
} from './availability.dto';

@ApiTags('scheduling')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/availability')
export class AvailabilityController {
  constructor(private readonly getAvailability: GetAvailabilityUseCase) {}

  @Get()
  @Roles('owner', 'admin', 'staff', 'client')
  @Throttle({ default: RATE_LIMITS.queryAvailability })
  @ApiOperation({
    operationId: 'availability_get',
    summary:
      'Huecos reservables de un servicio entre dos fechas (máximo 14 días de diferencia), calculados en la zona horaria del centro. Un hueco por hora de inicio.',
  })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: AvailabilityQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const availability = await this.getAvailability.execute({
      actor,
      serviceId: query.serviceId,
      fromDate: query.from,
      toDate: query.to,
      staffMembershipId: query.staffMembershipId ?? null,
      now: new Date(),
    });
    return {
      timezone: availability.timeZone,
      days: availability.days.map((day) => ({
        date: day.date,
        slots: day.slots.map((slot) => ({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          staffMembershipId: slot.staffMembershipId,
          staffName: slot.staffName,
        })),
      })),
    };
  }
}
