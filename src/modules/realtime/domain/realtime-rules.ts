import { z } from 'zod';

/** Dónde se abre el WebSocket. */
export const REALTIME_PATH = '/v1/realtime';

/** Código de cierre cuando la identidad no es válida o caduca: la app vuelve a conectar con un token nuevo. */
export const CLOSE_UNAUTHENTICATED = 4401;
/** Código de cierre cuando la misma persona abre demasiadas conexiones a la vez. */
export const CLOSE_TOO_MANY_CONNECTIONS = 4429;

/** Tiempo para identificarse tras conectar: sin mensaje de identificación se cierra. */
export const AUTH_TIMEOUT_MS = 5_000;
/** Igual que el token de acceso (10 min): pasado ese tiempo hay que volver a identificarse. */
export const MAX_CONNECTION_MS = 600_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** El primer mensaje solo lleva un token y un centro: cualquier cosa mayor es un abuso. */
export const MAX_MESSAGE_BYTES = 4_096;
export const MAX_CONNECTIONS_PER_MEMBERSHIP = 5;

/**
 * El token viaja en el primer mensaje y no en la URL: las URLs acaban en registros de servidores y
 * proxys (SEC-M5).
 */
export const authMessageSchema = z.strictObject({
  type: z.literal('auth'),
  accessToken: z.string().min(1).max(MAX_MESSAGE_BYTES),
  centerId: z.uuid(),
});

/** Lo que el servidor avisa. Nunca lleva contenido: la app recarga lo que cambió por la API normal. */
export type RealtimeEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'chat.updated'; readonly conversationId: string | null };

export function buildConnectionKey(input: { centerId: string; membershipId: string }): string {
  return `${input.centerId}:${input.membershipId}`;
}
