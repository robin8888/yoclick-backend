import { RequiresModule } from '../../../shared/auth/decorators/requires-module.decorator';
import { Controller, Delete, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { RequiresPlanFeature } from '../../../shared/auth/decorators/requires-plan-feature.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import {
  ListSessionWaitlistUseCase,
  RemoveFromSessionWaitlistUseCase,
} from '../application/waitlist.use-cases';
import { serializeSessionWaitlistPerson } from './serialize-waitlist-entry';
import {
  SessionWaitlistEntryRouteParamsDto,
  SessionWaitlistResponseDto,
  SessionWaitlistRouteParamsDto,
} from './waitlist.dto';

/** Lo que ve el personal del centro de la lista de espera de una clase. */
@ApiTags('waitlist')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@RequiresModule('waitlist')
@RequiresPlanFeature('waitlist')
@Controller('centers/:centerId/class-sessions/:classSessionId/waitlist')
export class SessionWaitlistController {
  constructor(
    private readonly listSessionWaitlist: ListSessionWaitlistUseCase,
    private readonly removeFromWaitlist: RemoveFromSessionWaitlistUseCase,
    private readonly push: PushDispatcher,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'waitlist_list_for_session',
    summary:
      'Quién espera una clase llena: las plazas ofrecidas pendientes de confirmar y la cola por orden de llegada.',
  })
  @ApiOkResponse({ type: SessionWaitlistResponseDto })
  async listForSession(
    @CurrentActor() actor: ActorContext,
    @Param() params: SessionWaitlistRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const people = await this.listSessionWaitlist.execute(actor, {
      classSessionId: params.classSessionId,
      now: new Date(),
    });
    return { entries: people.map(serializeSessionWaitlistPerson) };
  }

  @Delete(':entryId')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'waitlist_remove_from_session',
    summary:
      'El personal quita a una persona de la espera de la clase. Si tenía una plaza ofrecida, esa plaza se ofrece a la siguiente persona.',
  })
  @ApiNoContentResponse()
  async removeFromSession(
    @CurrentActor() actor: ActorContext,
    @Param() params: SessionWaitlistEntryRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.removeFromWaitlist.execute(actor, {
      entryId: params.entryId,
      classSessionId: params.classSessionId,
    });
    await this.push.flushCenter(actor);
  }
}
