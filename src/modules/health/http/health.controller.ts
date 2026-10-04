import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
}

@Controller('health')
export class HealthController {
  @Get()
  checkLiveness(): HealthResponse {
    return { status: 'ok' };
  }
}
