import { type OpenAPIObject } from '@nestjs/swagger';
import { stringify } from 'yaml';

/** Serialización determinista: el CI regenera el contrato y lo compara con el commiteado. */
export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return stringify(document, { lineWidth: 0 });
}
