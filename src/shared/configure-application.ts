import helmet from '@fastify/helmet';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';

const HSTS_MAX_AGE_SECONDS = 15_552_000;
const API_VERSION_PREFIX = 'v1';
/** Rutas de operación (no son API de negocio): sin versión para que balanceadores y monitores las encuentren. */
const UNVERSIONED_ROUTES = ['health'];

/**
 * Configuración HTTP común a producción, a los tests e2e y a la generación del contrato, para que
 * lo que se prueba y lo que se documenta sea exactamente lo que se despliega (SEC-60).
 */
export async function configureApplication(application: NestFastifyApplication): Promise<void> {
  application.setGlobalPrefix(API_VERSION_PREFIX, { exclude: UNVERSIONED_ROUTES });
  await application.register(helmet, {
    hsts: { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true },
    contentSecurityPolicy: false,
  });
}
