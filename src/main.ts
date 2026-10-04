import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { type Environment } from './shared/config/environment.schema';
import { configureApplication } from './shared/configure-application';
import { createFastifyAdapter } from './shared/create-fastify-adapter';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(),
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
