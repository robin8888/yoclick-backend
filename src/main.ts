import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { type Environment } from './shared/config/environment.schema';
import { configureApplication } from './shared/configure-application';

const MAX_REQUEST_BODY_BYTES = 1_048_576;

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: MAX_REQUEST_BODY_BYTES }),
    { bufferLogs: true },
  );
  application.useLogger(application.get(Logger));
  await configureApplication(application);

  const configService = application.get<ConfigService<Environment, true>>(ConfigService);
  await application.listen(
    configService.get('PORT', { infer: true }),
    configService.get('HOST', { infer: true }),
  );
}

void bootstrap();
