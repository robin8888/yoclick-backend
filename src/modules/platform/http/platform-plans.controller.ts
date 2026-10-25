import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { CurrentPlatformActor } from '../../../shared/auth/decorators/current-platform-actor.decorator';
import { PlatformRoles } from '../../../shared/auth/decorators/platform-roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import {
  ListPlatformPlansUseCase,
  UpdatePlatformPlanPricesUseCase,
} from '../application/platform.use-cases';
import {
  PlatformPlanListResponseDto,
  PlatformPlanResponseDto,
  PlatformPlanRouteParamsDto,
  UpdatePlatformPlanRequestDto,
} from './platform.dto';

/** Los planes de Yoclick (docs/spec/17 §2.1): precios, cuota de alta y cuántos centros tiene cada uno. */
@ApiTags('platform')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('platform/plans')
@PlatformRoles('admin')
@Throttle({ default: RATE_LIMITS.platformAdmin })
export class PlatformPlansController {
  constructor(
    private readonly listPlans: ListPlatformPlansUseCase,
    private readonly updatePlanPrices: UpdatePlatformPlanPricesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'platform_list_plans',
    summary:
      'Los planes con su precio mensual, anual y cuota de alta, sus límites, cuántos centros tiene cada uno por estado y los ingresos recurrentes al mes.',
  })
  @ApiOkResponse({ type: PlatformPlanListResponseDto })
  async plans(@CurrentPlatformActor() actor: PlatformActorContext): Promise<unknown> {
    return this.listPlans.execute(actor);
  }

  @Patch(':planId')
  @ApiOperation({
    operationId: 'platform_update_plan',
    summary:
      'Cambia el precio mensual, el anual o la cuota de alta de un plan (en céntimos, sin IVA). Cada cambio queda en el registro de auditoría.',
  })
  @ApiOkResponse({ type: PlatformPlanResponseDto })
  async updatePlan(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Param() params: PlatformPlanRouteParamsDto,
    @Body() body: UpdatePlatformPlanRequestDto,
  ): Promise<unknown> {
    return this.updatePlanPrices.execute(actor, params.planId, body);
  }
}
