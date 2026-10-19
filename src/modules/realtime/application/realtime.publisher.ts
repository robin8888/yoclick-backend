import { Injectable } from '@nestjs/common';
import { buildConnectionKey, type RealtimeEvent } from '../domain/realtime-rules';
import { RealtimeConnections } from './realtime-connections';

/**
 * Avisa en directo a quien está conectado. Los avisos nunca llevan contenido ni datos personales:
 * solo dicen qué cambió, y la app lo recarga por la API normal, que es la que decide quién ve qué.
 * Se llama DESPUÉS de confirmar la acción que lo provoca, para que la recarga ya vea el cambio.
 */
@Injectable()
export class RealtimePublisher {
  constructor(private readonly connections: RealtimeConnections) {}

  publishChatUpdated(input: {
    centerId: string;
    membershipIds: readonly string[];
    conversationId: string | null;
  }): void {
    const event: RealtimeEvent = { type: 'chat.updated', conversationId: input.conversationId };
    const keys = input.membershipIds.map((membershipId) =>
      buildConnectionKey({ centerId: input.centerId, membershipId }),
    );
    this.connections.send(keys, JSON.stringify(event));
  }
}
