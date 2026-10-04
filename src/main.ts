import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureApplication } from './shared/configure-application';

const MAX_REQUEST_BODY_BYTES = 1_048_576;
const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: MAX_REQUEST_BODY_BYTES }),
  );
  await configureApplication(application);
  // La lectura tipada y validada del puerto llega con la configuración (API-003).
  await application.listen(Number(process.env['PORT'] ?? DEFAULT_PORT), '0.0.0.0');
}

void bootstrap();
