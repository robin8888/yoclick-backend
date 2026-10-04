import helmet from '@fastify/helmet';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';

const HSTS_MAX_AGE_SECONDS = 15_552_000;

/**
 * Configuración HTTP común a producción y a los tests e2e, para que las pruebas
 * ejerciten exactamente lo que se despliega (SEC-60).
 */
export async function configureApplication(application: NestFastifyApplication): Promise<void> {
  await application.register(helmet, {
    hsts: { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true },
    contentSecurityPolicy: false,
  });
}
