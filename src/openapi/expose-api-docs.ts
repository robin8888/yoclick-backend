import { type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { type Environment } from '../shared/config/environment.schema';
import { buildOpenApiDocument } from './build-openapi-document';
import { shouldExposeApiDocs } from './should-expose-api-docs';

const API_DOCS_PATH = 'docs';

/** Sirve Swagger UI en /docs solo fuera de producción (SEC-61). */
export function exposeApiDocs(
  application: INestApplication,
  nodeEnv: Environment['NODE_ENV'],
): void {
  if (!shouldExposeApiDocs(nodeEnv)) return;
  SwaggerModule.setup(API_DOCS_PATH, application, buildOpenApiDocument(application));
}
