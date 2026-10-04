import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../../shared/auth/decorators/public.decorator';

class HealthResponseDto extends createZodDto(z.strictObject({ status: z.literal('ok') })) {}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @ApiOperation({
    operationId: 'health_check_liveness',
    summary: 'Comprueba que la API está viva. No requiere autenticación.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  checkLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
