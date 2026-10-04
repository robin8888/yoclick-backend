import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/shared/configure-application';

export async function createTestApplication(): Promise<NestFastifyApplication> {
  const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const application = testingModule.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApplication(application);
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
  return application;
}
