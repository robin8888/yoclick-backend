import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { type Environment } from '../config/environment.schema';
import { DEFAULT_RATE_LIMIT } from './rate-limit-policies';

export interface RateLimitSettings {
  readonly isEnabled: boolean;
}

/** Proveedor con el interruptor, para que un test concreto pueda activarlo sin tocar el entorno global. */
export const RATE_LIMIT_SETTINGS = Symbol('RATE_LIMIT_SETTINGS');

@Module({
  providers: [
    {
      provide: RATE_LIMIT_SETTINGS,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>): RateLimitSettings => ({
        isEnabled: configService.get('RATE_LIMITING', { infer: true }) === 'enabled',
      }),
    },
  ],
  exports: [RATE_LIMIT_SETTINGS],
})
class RateLimitSettingsModule {}

@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RateLimitSettingsModule],
      inject: [RATE_LIMIT_SETTINGS],
      useFactory: (settings: RateLimitSettings) => ({
        throttlers: [
          { name: 'default', ttl: DEFAULT_RATE_LIMIT.ttl, limit: DEFAULT_RATE_LIMIT.limit },
        ],
        skipIf: () => !settings.isEnabled,
      }),
    }),
  ],
  providers: [
    // Va ANTES que los guards de autenticación (AuthModule se importa después): un atacante que
    // adivina contraseñas debe topar con el límite sin llegar a gastar un hash de argon2.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class RateLimitModule {}
