import { type ModuleMetadata } from '@nestjs/common';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/shared/configure-application';
import { createFastifyAdapter } from '../../src/shared/create-fastify-adapter';

/** `extraModules`: módulos de sondeo que solo existen en tests, para provocar errores a propósito. */
export async function createTestApplication(
  extraModules: ModuleMetadata['imports'] = [],
): Promise<NestFastifyApplication> {
  const testingModule = await Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  }).compile();
  const application =
    testingModule.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
  await configureApplication(application);
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
  return application;
}
