import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { CurrentPlatformActor } from '../../../shared/auth/decorators/current-platform-actor.decorator';
import { PlatformRoles } from '../../../shared/auth/decorators/platform-roles.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { summarizeVoiceUsage } from '../domain/usage-minutes';
import {
  GetMyStudentCodeUseCase,
  GetVoiceOverviewUseCase,
  DeprovisionVoiceReceptionistUseCase,
  ListVoiceCallsUseCase,
  ProvisionVoiceReceptionistUseCase,
  SetVoiceEnabledUseCase,
  UpdateVoiceConfigUseCase,
} from '../application/voice-admin.use-cases';
import {
  VOICE_ADMIN_REPOSITORY,
  type VoiceAdminRepository,
} from '../application/ports/voice-admin.repository';
import {
  CenterRouteParamsDto,
  ProvisionVoiceRequestDto,
  StudentCodeResponseDto,
  UpdateVoiceConfigRequestDto,
  VoiceCallsQueryDto,
  VoiceCallsResponseDto,
  VoiceConfigResponseDto,
  VoiceOverviewResponseDto,
  VoiceUsageResponseDto,
} from './voice-receptionist.dto';
import { Inject } from '@nestjs/common';

/** Panel del centro para el Contestador IA: estado, ajustes, historial de llamadas y consumo de minutos. */
@ApiTags('voice-receptionist')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/voice-receptionist')
@Roles('owner', 'admin')
export class VoiceReceptionistController {
  constructor(
    private readonly getOverview: GetVoiceOverviewUseCase,
    private readonly updateConfig: UpdateVoiceConfigUseCase,
    private readonly setEnabled: SetVoiceEnabledUseCase,
    private readonly listCalls: ListVoiceCallsUseCase,
    @Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'voice_get_overview',
    summary:
      'Estado del Contestador IA del centro: si está contratado y activo, número puente, ajustes, lo que puede hacer según el plan, precio del add-on y consumo.',
  })
  @ApiOkResponse({ type: VoiceOverviewResponseDto })
  async overview(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const overview = await this.getOverview.execute(actor, new Date());
    return {
      planId: overview.planId,
      isEnabled: overview.isEnabled,
      line: overview.line,
      subscription:
        overview.subscription === null
          ? null
          : {
              ...overview.subscription,
              periodStart: overview.subscription.periodStart.toISOString(),
              periodEnd: overview.subscription.periodEnd.toISOString(),
            },
      config: overview.config,
      addonPlan:
        overview.addonPlan === null
          ? null
          : {
              monthlyPriceCents: overview.addonPlan.monthlyPriceCents,
              includedMinutes: overview.addonPlan.includedMinutes,
              overageCentsPerMinute: overview.addonPlan.overageCentsPerMinute,
            },
      capabilities: overview.capabilities,
      usage: overview.usage,
    };
  }

  @Put('config')
  @ApiOperation({
    operationId: 'voice_update_config',
    summary:
      'Cambia los ajustes del asistente. Saludo, nombre y voz propios son del plan Premium (402 PLAN_FEATURE_NOT_INCLUDED); el teléfono de transferencia no puede ser el del centro (422 VOICE_TRANSFER_PHONE_INVALID).',
  })
  @ApiOkResponse({ type: VoiceConfigResponseDto })
  async config(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: UpdateVoiceConfigRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.updateConfig.execute(actor, body)) };
  }

  @Post('enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'voice_enable',
    summary:
      'Activa el contestador. 402 VOICE_ADDON_NOT_CONTRACTED sin add-on contratado; 409 VOICE_LINE_NOT_ASSIGNED sin número puente.',
  })
  @ApiNoContentResponse()
  async enable(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.setEnabled.execute(actor, true);
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'voice_disable',
    summary: 'Apaga el contestador: la línea del centro sigue como antes de contratarlo.',
  })
  @ApiNoContentResponse()
  async disable(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.setEnabled.execute(actor, false);
  }

  @Get('calls')
  @ApiOperation({
    operationId: 'voice_list_calls',
    summary:
      'Historial de llamadas atendidas, de la más reciente a la más antigua, con su resultado. No incluye la transcripción.',
  })
  @ApiOkResponse({ type: VoiceCallsResponseDto })
  async calls(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: VoiceCallsQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const page = await this.listCalls.execute(actor, query);
    return {
      data: page.data.map((call) => ({ ...call, startedAt: call.startedAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }

  @Get('usage')
  @ApiOperation({
    operationId: 'voice_get_usage',
    summary: 'Minutos usados en el periodo actual frente a los incluidos.',
  })
  @ApiOkResponse({ type: VoiceUsageResponseDto })
  async usage(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const usage = await this.admin.getUsage(actor, new Date());
    if (usage === null)
      throw new DomainError('VOICE_ADDON_NOT_CONTRACTED', HTTP_STATUS.paymentRequired);
    return { periodStart: usage.periodStart.toISOString(), usage: summarizeVoiceUsage(usage) };
  }
}

/** El código de 6 cifras de quien mira, el que dice por teléfono al contestador. Se sortea la primera vez. */
@ApiTags('voice-receptionist')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/me/student-code')
export class StudentCodeController {
  constructor(private readonly getMyCode: GetMyStudentCodeUseCase) {}

  @Get()
  @Roles('client')
  @Throttle({ default: RATE_LIMITS.myStudentCode })
  @ApiOperation({
    operationId: 'voice_get_my_student_code',
    summary:
      'El código de 6 cifras de la persona en este centro: con él se identifica al llamar al contestador. Se crea la primera vez que se pide.',
  })
  @ApiOkResponse({ type: StudentCodeResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { code: await this.getMyCode.execute(actor) };
  }
}

/** Alta de un centro en el add-on desde la plataforma, hasta que la facturación (fase 3) lo haga sola. */
@ApiTags('voice-receptionist')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('platform/centers/:centerId/voice-receptionist')
@PlatformRoles('admin')
@Throttle({ default: RATE_LIMITS.platformAdmin })
export class PlatformVoiceReceptionistController {
  constructor(
    private readonly provision: ProvisionVoiceReceptionistUseCase,
    private readonly deprovision: DeprovisionVoiceReceptionistUseCase,
  ) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'platform_provision_voice_receptionist',
    summary:
      'Da de alta el add-on de un centro: asigna su número puente y crea su suscripción con los minutos de su plan. Con `shouldBillWithStripe` añade además el add-on como líneas de la suscripción de Stripe del centro (409 VOICE_ADDON_BILLING_NOT_READY si el centro no tiene suscripción o falta `billing:setup`). No lo activa: lo activa el centro.',
  })
  @ApiNoContentResponse()
  async put(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: ProvisionVoiceRequestDto,
  ): Promise<void> {
    await this.provision.execute(
      actor,
      {
        centerId: params.centerId,
        bridgeNumber: body.bridgeNumber,
        provider: body.provider,
        includedMinutes: body.includedMinutes,
        shouldBillWithStripe: body.shouldBillWithStripe,
      },
      new Date(),
    );
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'platform_deprovision_voice_receptionist',
    summary:
      'Da de baja el add-on de un centro: quita sus líneas de la suscripción de Stripe, cancela su suscripción del add-on y apaga el contestador.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentPlatformActor() actor: PlatformActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<void> {
    await this.deprovision.execute(actor, params.centerId);
  }
}
