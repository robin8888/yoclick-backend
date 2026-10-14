import { Readable } from 'node:stream';
import { type FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Los bytes exactos del cuerpo, solo en las rutas que piden verificar una firma. */
    rawBody?: Buffer;
  }
}

/**
 * Guarda el cuerpo sin interpretar de las rutas indicadas, porque una firma (Stripe) se calcula
 * sobre los bytes recibidos y no sobre el JSON vuelto a escribir. El resto de rutas no se toca.
 */
export function captureRawBodyOf(instance: FastifyInstance, paths: readonly string[]): void {
  instance.addHook('preParsing', async (request, _reply, payload) => {
    if (!paths.includes(request.url.split('?')[0] ?? '')) return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) chunks.push(Buffer.from(chunk as Uint8Array));
    const rawBody = Buffer.concat(chunks);
    request.rawBody = rawBody;
    return Readable.from([rawBody]);
  });
}
