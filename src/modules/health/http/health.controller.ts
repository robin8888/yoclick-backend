import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { z } from 'zod';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../../shared/auth/decorators/public.decorator';

class HealthResponseDto extends createZodDto(z.strictObject({ status: z.literal('ok') })) {}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  // Los monitores y balanceadores lo consultan sin parar: no debe contar contra el límite por IP.
  @SkipThrottle()
  @ApiOperation({
    operationId: 'health_check_liveness',
    summary: 'Comprueba que la API está viva. No requiere autenticación.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  checkLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
