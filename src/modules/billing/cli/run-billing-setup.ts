import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { parseEnvironment } from '../../../shared/config/parse-environment';
import { DatabaseModule } from '../../../shared/database/database.module';
import { SyncStripePlansUseCase } from '../application/billing.use-cases';
import { BillingModule } from '../billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: parseEnvironment }),
    DatabaseModule,
    BillingModule,
  ],
})
class BillingSetupModule {}

const logger = new Logger('BillingSetup');

async function runBillingSetup(): Promise<void> {
  const applicationContext = await NestFactory.createApplicationContext(BillingSetupModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const plans = await applicationContext.get(SyncStripePlansUseCase).execute();
    for (const plan of plans) {
      logger.log(
        `Plan ${plan.planId}: product ${plan.productId}, prices ${plan.monthlyPriceId} / ${plan.annualPriceId}`,
      );
    }
    logger.log(`${String(plans.length)} plans are ready in Stripe.`);
  } finally {
    await applicationContext.close();
  }
}

runBillingSetup().catch((error: unknown) => {
  // Solo el mensaje: nunca el objeto completo, que podría traer claves o la URL de la base.
  logger.error(error instanceof Error ? error.message : 'Billing setup failed');
  process.exitCode = 1;
});
