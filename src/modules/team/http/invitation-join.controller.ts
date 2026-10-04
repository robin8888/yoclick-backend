import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import {
  AcceptInvitationUseCase,
  GetInvitationPreviewUseCase,
} from '../application/invitation.use-cases';
import {
  AcceptedInvitationResponseDto,
  InvitationCodeParamsDto,
  InvitationPreviewResponseDto,
} from './team.dto';

/** El lado de quien recibe el código. El código es la credencial: poca superficie y límite por IP. */
@ApiTags('join')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('join/invitations')
export class InvitationJoinController {
  constructor(
    private readonly getPreview: GetInvitationPreviewUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
  ) {}

  @Get(':code')
  @Public()
  @Throttle({ default: RATE_LIMITS.submitCode })
  @ApiOperation({
    operationId: 'join_get_invitation',
    summary:
      'Centro y rol de una invitación, con el correo ofuscado. Un código inválido, caducado o usado responde 404 INVITATION_INVALID.',
  })
  @ApiOkResponse({ type: InvitationPreviewResponseDto })
  async preview(@Param() params: InvitationCodeParamsDto): Promise<Record<string, unknown>> {
    const preview = await this.getPreview.execute(params.code);
    return { ...preview, expiresAt: preview.expiresAt.toISOString() };
  }

  @Post(':code/accept')
  @UserScoped()
  @ApiBearerAuth('bearer')
  @Throttle({ default: RATE_LIMITS.submitCode })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'join_accept_invitation',
    summary:
      'Acepta la invitación con la cuenta cuyo correo coincide. Sirve una sola vez; nunca rebaja el rol de quien ya está dentro.',
  })
  @ApiOkResponse({ type: AcceptedInvitationResponseDto })
  async accept(
    @CurrentUserId() userId: string,
    @Param() params: InvitationCodeParamsDto,
  ): Promise<Record<string, unknown>> {
    return { ...(await this.acceptInvitation.execute(userId, params.code)) };
  }
}
