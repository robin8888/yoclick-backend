import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../src/shared/auth/decorators/public.decorator';
import { DomainError } from '../../src/shared/errors/domain-error';

class CreateProbeDto extends createZodDto(
  z.strictObject({ fullName: z.string().min(2), age: z.number().int().min(18) }),
) {}

/** Solo existe en tests: provoca a propósito cada tipo de fallo para comprobar cómo responde la API. */
@Controller('probe')
@Public()
class ErrorProbeController {
  @Get('domain-error')
  throwDomainError(): never {
    throw new DomainError('CONFLICT', 409);
  }

  @Get('crash')
  crash(): never {
    throw new Error(
      'connection refused to postgres://yoclick_app:S3cretPassw0rd@db.internal/yoclick',
    );
  }

  @Post('echo')
  echo(@Body() body: CreateProbeDto): { fullName: string } {
    return { fullName: body.fullName };
  }
}

@Module({ controllers: [ErrorProbeController] })
export class ErrorProbeModule {}
