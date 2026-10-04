import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './modules/health/health.module';
import { type Environment } from './shared/config/environment.schema';
import { parseEnvironment } from './shared/config/parse-environment';
import { DatabaseModule } from './shared/database/database.module';
import { buildLoggerOptions } from './shared/logging/build-logger-options';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: parseEnvironment }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>) =>
        buildLoggerOptions({
          NODE_ENV: configService.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: configService.get('LOG_LEVEL', { infer: true }),
        }),
    }),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
