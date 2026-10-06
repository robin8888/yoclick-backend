import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthIdentityModule } from './modules/auth/auth-identity.module';
import { CentersModule } from './modules/centers/centers.module';
import { JoinModule } from './modules/join/join.module';
import { TeamModule } from './modules/team/team.module';
import { ServicesModule } from './modules/services/services.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { ReportsModule } from './modules/reports/reports.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { MeModule } from './modules/me/me.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './shared/auth/auth.module';
import { type Environment } from './shared/config/environment.schema';
import { parseEnvironment } from './shared/config/parse-environment';
import { DatabaseModule } from './shared/database/database.module';
import { RateLimitModule } from './shared/rate-limit/rate-limit.module';
import { EmailModule } from './shared/email/email.module';
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
    // Antes que AuthModule: el límite por IP se aplica antes de autenticar.
    RateLimitModule,
    AuthModule,
    EmailModule,
    AuthIdentityModule,
    MeModule,
    JoinModule,
    OnboardingModule,
    TeamModule,
    CentersModule,
    ServicesModule,
    SchedulingModule,
    BookingsModule,
    ReportsModule,
    RoomsModule,
    HealthModule,
  ],
  providers: [
    // Toda entrada se valida con zod y todo error sale como Problem Details (RFC 9457).
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
