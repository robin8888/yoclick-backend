import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PasswordHasher } from '../shared/auth/password-hasher';
import { parseEnvironment } from '../shared/config/parse-environment';
import { DatabaseModule } from '../shared/database/database.module';
import { CenterDefaultsBackfiller } from './center-defaults-backfiller';
import { DemoSeeder } from './demo-seeder';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: parseEnvironment }),
    DatabaseModule,
  ],
  providers: [DemoSeeder, CenterDefaultsBackfiller, PasswordHasher],
})
export class SeedModule {}
