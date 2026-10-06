import { Controller, Get, Param } from '@nestjs/common';
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
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { GetConsentSummaryUseCase } from '../application/get-consent-summary.use-case';
import { ConsentSummaryResponseDto, PrivacyRouteParamsDto } from './privacy.dto';

/** «Privacidad y legal»: los consentimientos que han dado los clientes del centro. */
@ApiTags('privacy')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/privacy')
@Roles('owner', 'admin')
export class PrivacyController {
  constructor(private readonly getConsentSummary: GetConsentSummaryUseCase) {}

  @Get('consents')
  @ApiOperation({
    operationId: 'privacy_get_consent_summary',
    summary:
      'Cuántos clientes activos tienen concedido cada consentimiento (privacidad, salud, promociones, imagen y parental). Solo cifras, nunca quién.',
  })
  @ApiOkResponse({ type: ConsentSummaryResponseDto })
  async consents(
    @CurrentActor() actor: ActorContext,
    @Param() params: PrivacyRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    if (params.centerId !== actor.centerId) {
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
    return { ...(await this.getConsentSummary.execute(actor)) };
  }
}
