import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './shared/auth/auth.module';
import { type Environment } from './shared/config/environment.schema';
import { parseEnvironment } from './shared/config/parse-environment';
import { DatabaseModule } from './shared/database/database.module';
import { ProblemDetailsFilter } from './shared/errors/problem-details.filter';
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
    AuthModule,
    HealthModule,
  ],
  providers: [
    // Toda entrada se valida con zod y todo error sale como Problem Details (RFC 9457).
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
