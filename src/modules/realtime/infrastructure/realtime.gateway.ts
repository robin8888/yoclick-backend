import { type IncomingMessage, type Server } from 'node:http';
import { type Duplex } from 'node:stream';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { RealtimeConnections } from '../application/realtime-connections';
import {
  AUTH_TIMEOUT_MS,
  authMessageSchema,
  CLOSE_UNAUTHENTICATED,
  HEARTBEAT_INTERVAL_MS,
  MAX_CONNECTION_MS,
  MAX_MESSAGE_BYTES,
  REALTIME_PATH,
  type RealtimeEvent,
} from '../domain/realtime-rules';
import { RealtimeAuthenticator } from './realtime-authenticator';

/** Un mensaje de `ws` puede llegar en trozos o como bytes: aquí siempre es texto. */
function rawDataToText(rawMessage: RawData): string {
  if (Array.isArray(rawMessage)) return Buffer.concat(rawMessage).toString('utf8');
  if (rawMessage instanceof ArrayBuffer) return Buffer.from(rawMessage).toString('utf8');
  return rawMessage.toString('utf8');
}

interface LiveSocket extends WebSocket {
  isAlive?: boolean;
}

/**
 * El WebSocket de la app: una conexión por móvil que se identifica con su primer mensaje y desde
 * entonces recibe avisos de que algo cambió (un mensaje nuevo). No lleva contenido: la app recarga
 * por la API. Se cierra a los 10 minutos, como el token con el que se identificó, y la app vuelve a
 * conectar con uno nuevo.
 */
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly connections: RealtimeConnections,
    private readonly authenticator: RealtimeAuthenticator,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
    httpServer.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });
    this.heartbeat = setInterval(() => {
      this.checkHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.server.clients) client.terminate();
    this.server.close();
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = (request.url ?? '').split('?')[0];
    if (path !== REALTIME_PATH) {
      socket.destroy();
      return;
    }
    this.server.handleUpgrade(request, socket, head, (webSocket) => {
      this.acceptConnection(webSocket);
    });
  }

  private acceptConnection(webSocket: LiveSocket): void {
    webSocket.isAlive = true;
    webSocket.on('pong', () => {
      webSocket.isAlive = true;
    });
    const authTimer = setTimeout(() => {
      webSocket.close(CLOSE_UNAUTHENTICATED, 'auth_timeout');
    }, AUTH_TIMEOUT_MS);
    const expiryTimer = setTimeout(() => {
      webSocket.close(CLOSE_UNAUTHENTICATED, 'expired');
    }, MAX_CONNECTION_MS);
    webSocket.once('message', (rawMessage) => {
      clearTimeout(authTimer);
      this.authenticate(webSocket, rawMessage).catch((error: unknown) => {
        this.logger.warn(`Realtime authentication failed: ${String(error)}`);
        webSocket.close(CLOSE_UNAUTHENTICATED, 'unauthenticated');
      });
    });
    webSocket.on('close', () => {
      clearTimeout(authTimer);
      clearTimeout(expiryTimer);
      this.connections.unregister(webSocket);
    });
    webSocket.on('error', () => {
      webSocket.terminate();
    });
  }

  private async authenticate(webSocket: LiveSocket, rawMessage: RawData): Promise<void> {
    const message = authMessageSchema.parse(JSON.parse(rawDataToText(rawMessage)));
    const keys = await this.authenticator.resolveConnectionKeys(message);
    // Se apunta antes de avisar de que está lista: un mensaje enviado justo entonces no se pierde.
    this.connections.register(webSocket, keys);
    const ready: RealtimeEvent = { type: 'ready' };
    webSocket.send(JSON.stringify(ready));
  }

  /** Quien no contesta al ping en una vuelta deja de contar como conectado. */
  private checkHeartbeat(): void {
    for (const client of this.server.clients as Set<LiveSocket>) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }
}
