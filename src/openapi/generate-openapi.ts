import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { createFastifyAdapter } from '../shared/create-fastify-adapter';
import { buildOpenApiDocument } from './build-openapi-document';
import { serializeOpenApiDocument } from './serialize-openapi-document';

const OPENAPI_OUTPUT_PATH = join(__dirname, '..', '..', 'openapi.yaml');
// Generar el contrato no conecta con ninguna base de datos: basta una URL válida de relleno.
const PLACEHOLDER_DATABASE_URL = 'postgresql://openapi:placeholder@localhost:5432/openapi';

async function generateOpenApiFile(): Promise<void> {
  process.env['DATABASE_URL'] ??= PLACEHOLDER_DATABASE_URL;
  process.env['LOG_LEVEL'] = 'silent';

  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(),
    { logger: false },
  );
  writeFileSync(OPENAPI_OUTPUT_PATH, serializeOpenApiDocument(buildOpenApiDocument(application)));
  await application.close();
}

void generateOpenApiFile();
