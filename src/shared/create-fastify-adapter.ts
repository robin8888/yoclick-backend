import { randomUUID } from 'node:crypto';
import { FastifyAdapter } from '@nestjs/platform-fastify';

/** SEC-50: cuerpos JSON de hasta 1 MB. */
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

/**
 * Adaptador común a producción y a los tests e2e. El identificador de petición (`traceId`) lo genera
 * el servidor: no se confía en una cabecera del cliente, que podría falsificarlo o usarlo para
 * inyectar texto en los logs.
 */
export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    genReqId: () => randomUUID(),
  });
}
