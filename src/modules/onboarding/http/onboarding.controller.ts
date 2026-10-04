import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { IdempotencyService } from '../../../shared/idempotency/idempotency.service';
import { type JsonValue } from '../../../shared/idempotency/idempotency-store';
import { parseIdempotencyKeyHeader } from '../../../shared/idempotency/idempotency-key';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { CreateCenterUseCase } from '../application/create-center.use-case';
import { CreateCenterRequestDto, CreateCenterResponseDto } from './create-center.dto';

@ApiTags('onboarding')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('onboarding')
@UserScoped()
export class OnboardingController {
  constructor(
    private readonly createCenter: CreateCenterUseCase,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('centers')
  @Throttle({ default: RATE_LIMITS.createCenter })
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID por intención del usuario',
  })
  @ApiOperation({
    operationId: 'onboarding_create_center',
    summary:
      'Da de alta un centro en prueba de 14 días; quien lo crea queda como propietario. Repetir la misma Idempotency-Key devuelve el mismo centro.',
  })
  @ApiCreatedResponse({ type: CreateCenterResponseDto })
  async create(
    @CurrentUserId() userId: string,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: CreateCenterRequestDto,
  ): Promise<JsonValue> {
    const outcome = await this.idempotency.execute({
      userId,
      key: parseIdempotencyKeyHeader(idempotencyKeyHeader),
      operation: 'POST /v1/onboarding/centers',
      requestBody: body,
      work: async () => {
        const center = await this.createCenter.execute({
          ownerUserId: userId,
          name: body.name,
          sectorId: body.sectorId,
          brandColor: body.brandColor,
          city: body.city ?? null,
        });
        return { status: HttpStatus.CREATED, body: { ...center } };
      },
    });
    return outcome.body;
  }
}
