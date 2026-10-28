import { type ActorContext } from '../../../shared/tenancy/actor-context';

/**
 * El contestador actúa dentro de un centro ya resuelto por el número puente (nunca por lo que diga el modelo).
 * Para leer y escribir sus propias tablas y buscar personas por código lleva el rol `admin` del centro, sin
 * persona detrás. Las reservas, en cambio, siempre se firman con quien llama, como cliente.
 */
export function buildVoiceSystemActor(centerId: string): ActorContext {
  return { userId: '', centerId, membershipId: '', role: 'admin', permissions: [] };
}
