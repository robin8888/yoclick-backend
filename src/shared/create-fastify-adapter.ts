import { randomUUID } from 'node:crypto';
import { FastifyAdapter } from '@nestjs/platform-fastify';

/** SEC-50: cuerpos JSON de hasta 1 MB. */
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

/**
 * Un POST sin cuerpo (cancelar una reserva, por ejemplo) que lleva `Content-Type: application/json`,
 * como hace por defecto casi cualquier cliente HTTP, no es un error: Fastify lo rechaza con 400, aquí
 * se trata como "sin cuerpo". Se conserva su analizador seguro de JSON (rechaza `__proto__` y
 * `constructor`), así que un cuerpo mal formado sigue siendo un 400.
 */
function allowEmptyJsonBodies(adapter: FastifyAdapter): void {
  const parseJsonSecurely = adapter.getInstance().getDefaultJsonParser('error', 'error');
  // Registrar el analizador por Nest evita que en el arranque registre el suyo, que chocaría con este.
  adapter.useBodyParser(
    'application/json',
    false,
    { bodyLimit: MAX_REQUEST_BODY_BYTES },
    (request, body, done) => {
      const text = body.toString();
      if (text.trim() === '') {
        done(null, undefined);
        return;
      }
      void parseJsonSecurely(request, text, done);
    },
  );
}

/**
 * Adaptador común a producción y a los tests e2e. El identificador de petición (`traceId`) lo genera
 * el servidor: no se confía en una cabecera del cliente, que podría falsificarlo o usarlo para
 * inyectar texto en los logs.
 */
export function createFastifyAdapter(): FastifyAdapter {
  const adapter = new FastifyAdapter({
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    genReqId: () => randomUUID(),
  });
  allowEmptyJsonBodies(adapter);
  return adapter;
}
