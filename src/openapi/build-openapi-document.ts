import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/** Versión del CONTRATO (semver). Un cambio incompatible exige `/v2` o un periodo de compatibilidad. */
export const API_CONTRACT_VERSION = '0.1.0';

const PRODUCTION_SERVER_URL = 'https://api.yoclick.app';
const BEARER_SECURITY_SCHEME_NAME = 'bearer';

export function buildOpenApiDocument(application: INestApplication): OpenAPIObject {
  const documentConfiguration = new DocumentBuilder()
    .setTitle('Yoclick API')
    .setDescription('API multi-centro de reservas en marca blanca. Contrato canónico para la app.')
    .setVersion(API_CONTRACT_VERSION)
    .addServer(PRODUCTION_SERVER_URL)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      BEARER_SECURITY_SCHEME_NAME,
    )
    .build();

  const rawDocument = SwaggerModule.createDocument(application, documentConfiguration);
  // Convierte los esquemas zod de los DTO a JSON Schema válido para OpenAPI.
  return cleanupOpenApiDoc(rawDocument);
}
