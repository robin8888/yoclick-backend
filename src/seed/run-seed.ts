import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DemoSeeder } from './demo-seeder';
import { SeedModule } from './seed.module';

const logger = new Logger('DemoSeed');

async function runSeed(): Promise<void> {
  const applicationContext = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const summary = await applicationContext.get(DemoSeeder).run();
    logger.log(
      `Demo data ready: ${String(summary.centerCount)} centers, ${String(summary.userCount)} people, ${String(summary.membershipCount)} memberships.`,
    );
  } finally {
    await applicationContext.close();
  }
}

runSeed().catch((error: unknown) => {
  // Solo el mensaje de nuestro propio error: nunca el objeto completo, que podría traer la URL de la base.
  logger.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
