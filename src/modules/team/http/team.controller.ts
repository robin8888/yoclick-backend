import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
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
import { Throttle } from '@nestjs/throttler';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  InviteToCenterUseCase,
  ListPendingInvitationsUseCase,
  RevokeInvitationUseCase,
} from '../application/invitation.use-cases';
import { type TeamMember } from '../application/ports/team.repository';
import { ListTeamUseCase, UpdateTeamMemberUseCase } from '../application/team.use-cases';
import {
  CenterRouteParamsDto,
  InvitationResponseDto,
  InvitationRouteParamsDto,
  InviteRequestDto,
  PendingInvitationsResponseDto,
  TeamMemberResponseDto,
  TeamMemberRouteParamsDto,
  TeamResponseDto,
  UpdateTeamMemberRequestDto,
} from './team.dto';

/** La ruta lleva el id del centro; solo se atiende el del `X-Center-Id` verificado. Cualquier otro es un 404. */
function assertRouteTargetsActorCenter(actor: ActorContext, routeCenterId: string): void {
  if (routeCenterId !== actor.centerId) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
}

function serializeMember(member: TeamMember): Record<string, unknown> {
  return { ...member, joinedAt: member.joinedAt.toISOString() };
}

@ApiTags('team')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class TeamController {
  constructor(
    private readonly listTeam: ListTeamUseCase,
    private readonly updateTeamMember: UpdateTeamMemberUseCase,
    private readonly invite: InviteToCenterUseCase,
    private readonly listPendingInvitations: ListPendingInvitationsUseCase,
    private readonly revokeInvitation: RevokeInvitationUseCase,
  ) {}

  @Get('team')
  @Roles('owner', 'admin')
  @ApiOperation({ operationId: 'team_list', summary: 'Quienes trabajan en el centro.' })
  @ApiOkResponse({ type: TeamResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { members: (await this.listTeam.execute(actor)).map(serializeMember) };
  }

  @Patch('team/:membershipId')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'team_update_member',
    summary:
      'Cambia rol, permisos, cargo o estado de alguien del equipo. La propietaria no se toca; solo ella gestiona administradoras.',
  })
  @ApiOkResponse({ type: TeamMemberResponseDto })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param() params: TeamMemberRouteParamsDto,
    @Body() body: UpdateTeamMemberRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const member = await this.updateTeamMember.execute({
      actor,
      membershipId: params.membershipId,
      update: body,
    });
    return serializeMember(member);
  }

  @Get('invitations')
  @Roles('owner', 'admin')
  @ApiOperation({ operationId: 'invitations_list_pending', summary: 'Invitaciones pendientes.' })
  @ApiOkResponse({ type: PendingInvitationsResponseDto })
  async listInvitations(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const pending = await this.listPendingInvitations.execute(actor);
    return {
      invitations: pending.map((invitation) => ({
        ...invitation,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      })),
    };
  }

  @Post('invitations')
  @Roles('owner', 'admin', 'staff')
  @Throttle({ default: RATE_LIMITS.accountSecurity })
  @ApiOperation({
    operationId: 'invitations_create',
    summary:
      'Invita a un cliente, a alguien del equipo o a otra administradora, por correo o por teléfono (uno de los dos). Con correo, la API lo envía (sin enlaces). Con teléfono, la app comparte el código por WhatsApp o SMS y vale con cualquier cuenta. El personal solo invita clientes. La respuesta trae el código una sola vez.',
  })
  @ApiCreatedResponse({ type: InvitationResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: InviteRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const invitation = await this.invite.execute({
      actor,
      email: body.email,
      phone: body.phone,
      role: body.role,
    });
    return { ...invitation, expiresAt: invitation.expiresAt.toISOString() };
  }

  @Delete('invitations/:invitationId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'invitations_revoke', summary: 'Anula una invitación pendiente.' })
  @ApiNoContentResponse()
  async revoke(
    @CurrentActor() actor: ActorContext,
    @Param() params: InvitationRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.revokeInvitation.execute(actor, params.invitationId);
  }
}
