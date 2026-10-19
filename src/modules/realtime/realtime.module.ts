import { Global, Module } from '@nestjs/common';
import { RealtimeConnections } from './application/realtime-connections';
import { RealtimePublisher } from './application/realtime.publisher';
import { RealtimeAuthenticator } from './infrastructure/realtime-authenticator';
import { RealtimeGateway } from './infrastructure/realtime.gateway';

/** Global: cualquier módulo puede avisar en directo sin importar este. */
@Global()
@Module({
  providers: [RealtimeConnections, RealtimePublisher, RealtimeAuthenticator, RealtimeGateway],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}
