import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { configureApplication } from '../shared/configure-application';
import { createFastifyAdapter } from '../shared/create-fastify-adapter';
import { buildOpenApiDocument } from './build-openapi-document';
import { serializeOpenApiDocument } from './serialize-openapi-document';

const OPENAPI_OUTPUT_PATH = join(__dirname, '..', '..', 'openapi.yaml');
const PLACEHOLDER_PEPPER_BYTES = 32;

/**
 * Generar el contrato no conecta con la base de datos ni firma nada: basta con valores de relleno que
 * superen la validación de configuración, de modo que funcione igual en tu equipo y en CI (sin .env).
 */
function fillPlaceholderEnvironment(): void {
  process.env['DATABASE_URL'] ??= 'postgresql://openapi:placeholder@localhost:5432/openapi';
  process.env['JWT_ACCESS_PRIVATE_KEY_BASE64'] ??= 'placeholder';
  process.env['JWT_ACCESS_PUBLIC_KEY_BASE64'] ??= 'placeholder';
  process.env['AUTH_CODE_PEPPER_BASE64'] ??=
    Buffer.alloc(PLACEHOLDER_PEPPER_BYTES).toString('base64');
  process.env['MFA_ENCRYPTION_KEY_BASE64'] ??=
    Buffer.alloc(PLACEHOLDER_PEPPER_BYTES).toString('base64');
  process.env['LOG_LEVEL'] = 'silent';
}

async function generateOpenApiFile(): Promise<void> {
  fillPlaceholderEnvironment();

  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(),
    { logger: false },
  );
  // La misma configuración HTTP que producción: así el contrato incluye el prefijo /v1.
  await configureApplication(application);
  writeFileSync(OPENAPI_OUTPUT_PATH, serializeOpenApiDocument(buildOpenApiDocument(application)));
  await application.close();
}

void generateOpenApiFile();
