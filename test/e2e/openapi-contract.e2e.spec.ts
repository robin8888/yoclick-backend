import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { buildOpenApiDocument } from '../../src/openapi/build-openapi-document';
import { serializeOpenApiDocument } from '../../src/openapi/serialize-openapi-document';
import { configureApplication } from '../../src/shared/configure-application';
import { createFastifyAdapter } from '../../src/shared/create-fastify-adapter';

interface RegisteredRoute {
  method: string;
  url: string;
}

interface OpenApiOperation {
  operationId?: string;
  tags?: string[];
}

type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;

const OPENAPI_FILE_PATH = join(__dirname, '..', '..', 'openapi.yaml');
const STABLE_OPERATION_ID_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const HTTP_METHODS_WITH_OPERATIONS = ['get', 'post', 'put', 'patch', 'delete'];

function toOpenApiPath(fastifyUrl: string): string {
  return fastifyUrl.replaceAll(/:(\w+)/g, '{$1}');
}

describe('OpenAPI contract', () => {
  let application: NestFastifyApplication;
  let registeredRoutes: RegisteredRoute[];
  let generatedPaths: OpenApiPaths;
  let generatedYaml: string;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application =
      testingModule.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    registeredRoutes = [];
    application
      .getHttpAdapter()
      .getInstance()
      .addHook('onRoute', (route) => {
        for (const method of [route.method].flat()) {
          registeredRoutes.push({ method, url: route.url });
        }
      });
    await configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();

    const document = buildOpenApiDocument(application);
    generatedPaths = document.paths as OpenApiPaths;
    generatedYaml = serializeOpenApiDocument(document);
  });

  afterAll(async () => {
    await application.close();
  });

  it('matches the committed openapi.yaml (run `npm run openapi:gen` after changing a DTO)', () => {
    const committedYaml = readFileSync(OPENAPI_FILE_PATH, 'utf8').replaceAll('\r\n', '\n');

    expect(committedYaml).toBe(generatedYaml);
  });

  it('documents every route the server exposes, so nothing ships undocumented (SEC-64)', () => {
    const documentedOperations = new Set(
      Object.entries(generatedPaths).flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
      ),
    );

    const undocumentedRoutes = registeredRoutes
      .filter((route) => route.method !== 'HEAD' && route.method !== 'OPTIONS')
      .map((route) => `${route.method} ${toOpenApiPath(route.url)}`)
      .filter((operation) => !documentedOperations.has(operation));

    expect(undocumentedRoutes).toEqual([]);
  });

  it('gives every operation a stable snake_case operationId and at least one tag', () => {
    const operations = Object.entries(generatedPaths).flatMap(([path, pathItem]) =>
      Object.entries(pathItem)
        .filter(([method]) => HTTP_METHODS_WITH_OPERATIONS.includes(method))
        .map(([method, operation]) => ({ label: `${method.toUpperCase()} ${path}`, operation })),
    );

    expect(operations.length).toBeGreaterThan(0);
    for (const { label, operation } of operations) {
      expect({
        label,
        valid: STABLE_OPERATION_ID_PATTERN.test(operation.operationId ?? ''),
      }).toEqual({
        label,
        valid: true,
      });
      expect({ label, hasTag: (operation.tags ?? []).length > 0 }).toEqual({ label, hasTag: true });
    }
  });

  it('declares only HTTPS servers and a bearer JWT security scheme', () => {
    const document = buildOpenApiDocument(application);

    expect(document.servers?.every((server) => server.url.startsWith('https://'))).toBe(true);
    expect(document.components?.securitySchemes).toMatchObject({
      bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    });
  });
});
