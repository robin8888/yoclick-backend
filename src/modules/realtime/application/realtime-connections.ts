import { Injectable } from '@nestjs/common';
import {
  CLOSE_TOO_MANY_CONNECTIONS,
  MAX_CONNECTIONS_PER_MEMBERSHIP,
} from '../domain/realtime-rules';

/** Lo único que se necesita de un WebSocket: así el registro se prueba sin red. */
export interface RealtimeSocket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

/**
 * Quién está conectado: cada conexión se apunta bajo las claves `centro:membresía` que le
 * corresponden (la suya y las de los hijos de los que es tutor). Vive en memoria de este proceso;
 * con varias instancias bastará con difundir los avisos por Redis.
 */
@Injectable()
export class RealtimeConnections {
  private readonly socketsByKey = new Map<string, Set<RealtimeSocket>>();
  private readonly keysBySocket = new Map<RealtimeSocket, readonly string[]>();

  register(socket: RealtimeSocket, keys: readonly string[]): void {
    this.keysBySocket.set(socket, keys);
    for (const key of keys) {
      const sockets = this.socketsByKey.get(key) ?? new Set<RealtimeSocket>();
      sockets.add(socket);
      this.socketsByKey.set(key, sockets);
      this.closeOldestBeyondLimit(sockets);
    }
  }

  unregister(socket: RealtimeSocket): void {
    for (const key of this.keysBySocket.get(socket) ?? []) {
      const sockets = this.socketsByKey.get(key);
      sockets?.delete(socket);
      if (sockets?.size === 0) this.socketsByKey.delete(key);
    }
    this.keysBySocket.delete(socket);
  }

  /** Cada conexión recibe el aviso una sola vez aunque coincida en varias claves. */
  send(keys: readonly string[], payload: string): void {
    const recipients = new Set<RealtimeSocket>();
    for (const key of keys) {
      for (const socket of this.socketsByKey.get(key) ?? []) recipients.add(socket);
    }
    for (const socket of recipients) socket.send(payload);
  }

  countFor(key: string): number {
    return this.socketsByKey.get(key)?.size ?? 0;
  }

  private closeOldestBeyondLimit(sockets: Set<RealtimeSocket>): void {
    while (sockets.size > MAX_CONNECTIONS_PER_MEMBERSHIP) {
      const [oldest] = sockets;
      if (oldest === undefined) return;
      oldest.close(CLOSE_TOO_MANY_CONNECTIONS, 'too_many_connections');
      this.unregister(oldest);
    }
  }
}
