import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { ListBusyTimesUseCase } from '../application/schedule.use-cases';
import { BusyTimesQueryDto, BusyTimesResponseDto, CenterRouteParamsDto } from './schedule.dto';

@ApiTags('schedules')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/schedules/busy-times')
export class BusyTimesController {
  constructor(private readonly listBusy: ListBusyTimesUseCase) {}

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'schedules_busy_times',
    summary:
      'Las franjas de la semana que ya ocupan una sala y/o un profesor con clases activas: lo que no se puede elegir al crear una clase nueva.',
  })
  @ApiOkResponse({ type: BusyTimesResponseDto })
  async busyTimes(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: BusyTimesQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const busy = await this.listBusy.execute(actor, {
      roomId: query.roomId ?? null,
      staffMembershipId: query.staffMembershipId ?? null,
    });
    return { busy };
  }
}
