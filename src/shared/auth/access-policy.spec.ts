import { Reflector } from '@nestjs/core';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { UserScoped } from './decorators/user-scoped.decorator';
import { readAccessPolicy } from './access-policy';

const reflector = new Reflector();

/** Crea una clase con un método decorado, como lo haría un controlador. */
function buildController(
  methodDecorators: MethodDecorator[],
  classDecorators: ClassDecorator[] = [],
): { handler: () => void; controllerClass: new () => object } {
  class ProbeController {
    handleRequest(): void {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(ProbeController.prototype, 'handleRequest');
  if (!descriptor) throw new Error('fixture failure');
  for (const decorator of methodDecorators) {
    decorator(ProbeController.prototype, 'handleRequest', descriptor);
  }
  for (const decorator of classDecorators) decorator(ProbeController);
  return { handler: descriptor.value as () => void, controllerClass: ProbeController };
}

describe('readAccessPolicy', () => {
  it('reads a public route', () => {
    const { handler, controllerClass } = buildController([Public()]);

    expect(readAccessPolicy(reflector, handler, controllerClass)).toEqual({ kind: 'public' });
  });

  it('reads a route open to any authenticated person', () => {
    const { handler, controllerClass } = buildController([UserScoped()]);

    expect(readAccessPolicy(reflector, handler, controllerClass)).toEqual({ kind: 'user' });
  });

  it('reads the roles allowed on a center route', () => {
    const { handler, controllerClass } = buildController([Roles('owner', 'admin')]);

    expect(readAccessPolicy(reflector, handler, controllerClass)).toEqual({
      kind: 'roles',
      roles: ['owner', 'admin'],
    });
  });

  it('is undeclared when the route says nothing: access is denied by default (SEC-53)', () => {
    const { handler, controllerClass } = buildController([]);

    expect(readAccessPolicy(reflector, handler, controllerClass)).toEqual({ kind: 'undeclared' });
  });

  it('inherits the policy declared on the whole controller', () => {
    const { handler, controllerClass } = buildController([], [Roles('owner')]);

    expect(readAccessPolicy(reflector, handler, controllerClass)).toEqual({
      kind: 'roles',
      roles: ['owner'],
    });
  });

  it('lets a method override the policy of its controller', () => {
    const { handler, controllerClass } = buildController([Public()], [Roles('owner')]);

    expect(readAccessPolicy(reflector, handler, controllerClass)).toEqual({ kind: 'public' });
  });

  it.each([
    ['public and roles', [Public(), Roles('admin')]],
    ['public and user-scoped', [Public(), UserScoped()]],
    ['user-scoped and roles', [UserScoped(), Roles('admin')]],
  ])(
    'treats contradictory declarations (%s) as undeclared, never as the most permissive',
    (_n, decorators) => {
      const { handler, controllerClass } = buildController(decorators);

      expect(readAccessPolicy(reflector, handler, controllerClass)).toEqual({ kind: 'undeclared' });
    },
  );

  it('treats @Roles() with no roles as undeclared: an empty list must not mean "anyone"', () => {
    const { handler, controllerClass } = buildController([Roles()]);

    expect(readAccessPolicy(reflector, handler, controllerClass)).toEqual({ kind: 'undeclared' });
  });
});
