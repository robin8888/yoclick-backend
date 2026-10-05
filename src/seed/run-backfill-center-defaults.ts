import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CenterDefaultsBackfiller } from './center-defaults-backfiller';
import { SeedModule } from './seed.module';

const logger = new Logger('CenterDefaultsBackfill');

async function runBackfill(): Promise<void> {
  const applicationContext = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const summary = await applicationContext.get(CenterDefaultsBackfiller).run();
    logger.log(
      `Checked ${String(summary.centerCount)} centers: ${String(summary.centersWithNewServices)} got services (${String(summary.createdServiceCount)} created), ${String(summary.centersWithNewOpeningHours)} got the default opening hours.`,
    );
  } finally {
    await applicationContext.close();
  }
}

runBackfill().catch((error: unknown) => {
  // Solo el mensaje de nuestro propio error: nunca el objeto completo, que podría traer la URL de la base.
  logger.error(error instanceof Error ? error.message : 'Backfill failed');
  process.exitCode = 1;
});
