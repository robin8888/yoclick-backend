import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
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
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import {
  ListNotificationsUseCase,
  MarkNotificationsReadUseCase,
} from '../application/notification.use-cases';
import {
  CenterRouteParamsDto,
  NotificationListQueryDto,
  NotificationListResponseDto,
  NotificationRouteParamsDto,
} from './notification.dto';

@ApiTags('notifications')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/notifications')
export class NotificationsController {
  constructor(
    private readonly listNotifications: ListNotificationsUseCase,
    private readonly markRead: MarkNotificationsReadUseCase,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'notifications_list',
    summary:
      'Los avisos de quien pregunta (nuevas reservas y cancelaciones), del más reciente al más antiguo, con el número de no leídos.',
  })
  @ApiOkResponse({ type: NotificationListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: NotificationListQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const result = await this.listNotifications.execute(actor, { limit: query.limit });
    return {
      unreadCount: result.unreadCount,
      notifications: result.notifications.map((notification) => ({
        ...notification,
        createdAt: notification.createdAt.toISOString(),
      })),
    };
  }

  @Post('read')
  @Roles('owner', 'admin', 'staff', 'client')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notifications_read_all',
    summary: 'Marca como leídos todos los avisos de quien pregunta.',
  })
  @ApiNoContentResponse()
  async readAll(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.markRead.execute(actor, null);
  }

  @Post(':notificationId/read')
  @Roles('owner', 'admin', 'staff', 'client')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notifications_read',
    summary: 'Marca como leído un aviso propio. 404 si no existe o es de otra persona.',
  })
  @ApiNoContentResponse()
  async read(
    @CurrentActor() actor: ActorContext,
    @Param() params: NotificationRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.markRead.execute(actor, params.notificationId);
  }
}
