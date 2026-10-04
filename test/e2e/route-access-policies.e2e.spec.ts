import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { readAccessPolicy } from '../../src/shared/auth/access-policy';

type ControllerMethod = (...parameters: unknown[]) => unknown;

interface RouteHandler {
  readonly label: string;
  readonly handler: ControllerMethod;
  readonly controllerClass: new (...parameters: never[]) => object;
}

function isRouteHandler(candidate: unknown): candidate is ControllerMethod {
  return typeof candidate === 'function' && Reflect.hasMetadata(PATH_METADATA, candidate);
}

describe('every route declares who may call it (SEC-53)', () => {
  let routeHandlers: RouteHandler[];
  let reflector: Reflector;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    const discoveryService = testingModule.get(DiscoveryService);
    const metadataScanner = testingModule.get(MetadataScanner);
    reflector = testingModule.get(Reflector);

    routeHandlers = discoveryService.getControllers().flatMap((wrapper) => {
      const prototype = Object.getPrototypeOf(wrapper.instance ?? {}) as Record<string, unknown>;
      const controllerClass = wrapper.metatype as RouteHandler['controllerClass'];
      return metadataScanner.getAllMethodNames(prototype).flatMap((methodName) => {
        const handler = prototype[methodName];
        return isRouteHandler(handler)
          ? [{ label: `${controllerClass.name}.${methodName}`, handler, controllerClass }]
          : [];
      });
    });
  });

  it('finds the application routes, so this check can never pass by looking at nothing', () => {
    expect(routeHandlers.length).toBeGreaterThan(0);
  });

  it('has no route without an explicit access policy', () => {
    const routesWithoutPolicy = routeHandlers
      .filter(
        ({ handler, controllerClass }) =>
          readAccessPolicy(reflector, handler, controllerClass).kind === 'undeclared',
      )
      .map(({ label }) => label);

    expect(routesWithoutPolicy).toEqual([]);
  });
});
