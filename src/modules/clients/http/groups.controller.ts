import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
  ArchiveGroupUseCase,
  CreateGroupUseCase,
  ListGroupsUseCase,
} from '../application/group.use-cases';
import {
  CenterRouteParamsDto,
  CreateGroupRequestDto,
  GroupListResponseDto,
  GroupResponseDto,
  GroupRouteParamsDto,
} from './client.dto';
import { ActivityRecorder } from '../../activity/application/activity-recorder';

@ApiTags('clients')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/groups')
export class GroupsController {
  constructor(
    private readonly listGroups: ListGroupsUseCase,
    private readonly createGroup: CreateGroupUseCase,
    private readonly archiveGroup: ArchiveGroupUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'groups_list',
    summary: 'Grupos de clientes del centro, con su nivel, quien los da y cuántas personas tienen.',
  })
  @ApiOkResponse({ type: GroupListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { groups: await this.listGroups.execute(actor) };
  }

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'groups_create',
    summary: 'Crea un grupo. 409 si ya hay uno activo con ese nombre.',
  })
  @ApiCreatedResponse({ type: GroupResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CreateGroupRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const group = await this.createGroup.execute(actor, {
      name: body.name,
      level: body.level ?? null,
      instructorMembershipId: body.instructorMembershipId ?? null,
    });
    await this.activity.record(actor, { kind: 'group_created', subject: group.name });
    return { ...group };
  }

  @Delete(':groupId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'groups_archive',
    summary: 'Quita el grupo: sus clientes quedan sin grupo; el rastro se conserva.',
  })
  @ApiNoContentResponse()
  async archive(
    @CurrentActor() actor: ActorContext,
    @Param() params: GroupRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.archiveGroup.execute(actor, params.groupId);
    await this.activity.record(actor, { kind: 'group_archived' });
  }
}
