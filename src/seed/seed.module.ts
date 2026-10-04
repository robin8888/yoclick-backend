import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PasswordHasher } from '../shared/auth/password-hasher';
import { parseEnvironment } from '../shared/config/parse-environment';
import { DatabaseModule } from '../shared/database/database.module';
import { DemoSeeder } from './demo-seeder';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: parseEnvironment }),
    DatabaseModule,
  ],
  providers: [DemoSeeder, PasswordHasher],
})
export class SeedModule {}
