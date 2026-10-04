import { type ModuleMetadata } from '@nestjs/common';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/shared/configure-application';
import { createFastifyAdapter } from '../../src/shared/create-fastify-adapter';

interface ProviderOverride {
  readonly token: symbol | (new (...parameters: never[]) => object);
  readonly value: unknown;
}

interface TestApplicationOptions {
  /** Módulos de sondeo que solo existen en tests, para provocar errores a propósito. */
  readonly extraModules?: ModuleMetadata['imports'];
  /** Sustituye proveedores reales (correo, comprobador de contraseñas filtradas) por dobles. */
  readonly overrides?: readonly ProviderOverride[];
}

export async function createTestApplication(
  options: TestApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const testingModuleBuilder = Test.createTestingModule({
    imports: [AppModule, ...(options.extraModules ?? [])],
  });
  for (const override of options.overrides ?? []) {
    testingModuleBuilder.overrideProvider(override.token).useValue(override.value);
  }

  const testingModule = await testingModuleBuilder.compile();
  const application =
    testingModule.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
  await configureApplication(application);
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
  return application;
}
