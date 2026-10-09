import { randomUUID } from 'node:crypto';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { MAX_DOCUMENT_SIZE_BYTES, PDF_CONTENT_TYPE } from '../modules/content/domain/content-rules';

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

const DOCUMENT_UPLOAD_PATH = /^\/v1\/centers\/[^/?]+\/content\/documents(?:\?.*)?$/;

/**
 * Un móvil manda el fichero con el tipo que le parece (`application/octet-stream`, o ninguno) aunque
 * la app pida `application/pdf`. Al subir un PDF el tipo no decide nada —se comprueba por contenido—,
 * así que en esa ruta, y solo en ella, se trata siempre como PDF.
 */
function treatDocumentUploadsAsPdf(adapter: FastifyAdapter): void {
  adapter.getInstance().addHook('onRequest', (request, _reply, done) => {
    if (request.method === 'POST' && DOCUMENT_UPLOAD_PATH.test(request.url)) {
      request.headers['content-type'] = PDF_CONTENT_TYPE;
    }
    done();
  });
}

/** Un PDF llega como el cuerpo entero de la petición: se entrega tal cual, como bytes, con su propio tope. */
function acceptPdfBodies(adapter: FastifyAdapter): void {
  adapter.useBodyParser(
    PDF_CONTENT_TYPE,
    false,
    { bodyLimit: MAX_DOCUMENT_SIZE_BYTES },
    (_request, body, done) => {
      done(null, body);
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
  acceptPdfBodies(adapter);
  treatDocumentUploadsAsPdf(adapter);
  return adapter;
}
