import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
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
import { UploadCenterLogoUseCase } from '../application/upload-center-logo.use-case';
import {
  CenterLogoParamsDto,
  CreateCenterRequestDto,
  CreateCenterResponseDto,
  UploadCenterLogoRequestDto,
  UploadCenterLogoResponseDto,
} from './create-center.dto';

@ApiTags('onboarding')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('onboarding')
@UserScoped()
export class OnboardingController {
  constructor(
    private readonly createCenter: CreateCenterUseCase,
    private readonly uploadCenterLogo: UploadCenterLogoUseCase,
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

  /**
   * No exige MFA a propósito: es un paso del alta del propietario recién creado, que todavía no
   * ha podido activar la verificación en dos pasos (igual que `POST /v1/onboarding/centers`). La
   * defensa es la comprobación de propiedad: solo el propietario activo del centro puede subirlo.
   */
  @Put('centers/:centerId/logo')
  @Throttle({ default: RATE_LIMITS.uploadCenterLogo })
  @ApiOperation({
    operationId: 'onboarding_upload_center_logo',
    summary:
      'Sube (o sustituye) el logo del centro: PNG, JPEG o WebP de hasta 700 KB en base64. Solo su propietario; para el resto, 404.',
  })
  @ApiOkResponse({ type: UploadCenterLogoResponseDto })
  async uploadLogo(
    @CurrentUserId() userId: string,
    @Param() params: CenterLogoParamsDto,
    @Body() body: UploadCenterLogoRequestDto,
  ): Promise<{ logoUrl: string }> {
    return this.uploadCenterLogo.execute({
      ownerUserId: userId,
      centerId: params.centerId,
      upload: { contentType: body.contentType, dataBase64: body.dataBase64 },
    });
  }
}
