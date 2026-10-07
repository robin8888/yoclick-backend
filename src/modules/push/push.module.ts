import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../shared/config/environment.schema';
import { PUSH_SENDER, type PushSender } from './application/ports/push-sender';
import { PushDispatcher } from './application/push-dispatcher';
import { PushDevicesController } from './http/push-devices.controller';
import { ConsolePushSender } from './infrastructure/console-push-sender';
import { ExpoPushSender } from './infrastructure/expo-push-sender';

/** Global: cualquier módulo que deje un aviso puede pedir su envío sin importar este módulo. */
@Global()
@Module({
  controllers: [PushDevicesController],
  providers: [
    {
      provide: PUSH_SENDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>): PushSender =>
        configService.get('PUSH_PROVIDER', { infer: true }) === 'expo'
          ? new ExpoPushSender(configService.get('EXPO_ACCESS_TOKEN', { infer: true }))
          : new ConsolePushSender(),
    },
    PushDispatcher,
  ],
  exports: [PushDispatcher, PUSH_SENDER],
})
export class PushModule {}
