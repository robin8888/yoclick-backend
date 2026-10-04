import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { z } from 'zod';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { GetCenterBrandingUseCase } from '../application/get-center-branding.use-case';

const BRANDING_CACHE_CONTROL = 'public, max-age=300';

class CenterBrandingParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

class CenterBrandingResponseDto extends createZodDto(
  z.strictObject({
    centerId: z.uuid(),
    name: z.string(),
    sectorId: z.string(),
    brandColor: z.string(),
  }),
) {}

@ApiTags('centers')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class BrandingController {
  constructor(private readonly getCenterBranding: GetCenterBrandingUseCase) {}

  @Get('branding')
  @Public()
  @Header('cache-control', BRANDING_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'centers_get_branding',
    summary: 'Nombre, sector y color de un centro. Público y cacheable cinco minutos.',
  })
  @ApiOkResponse({ type: CenterBrandingResponseDto })
  async branding(@Param() params: CenterBrandingParamsDto): Promise<Record<string, unknown>> {
    return { ...(await this.getCenterBranding.execute(params.centerId)) };
  }
}
