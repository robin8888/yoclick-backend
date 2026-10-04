import { type Reflector } from '@nestjs/core';
import { type MembershipRoleName } from '../tenancy/actor-context';
import { ALLOWED_ROLES_ROUTE_KEY } from './decorators/roles.decorator';
import { IS_PUBLIC_ROUTE_KEY } from './decorators/public.decorator';
import { IS_USER_SCOPED_ROUTE_KEY } from './decorators/user-scoped.decorator';

export type AccessPolicy =
  | { readonly kind: 'public' }
  | { readonly kind: 'user' }
  | { readonly kind: 'roles'; readonly roles: readonly MembershipRoleName[] }
  /** La ruta no declara quién puede llamarla (o se contradice): se deniega. */
  | { readonly kind: 'undeclared' };

interface Declarations {
  readonly isPublic: boolean;
  readonly isUserScoped: boolean;
  readonly roles: readonly MembershipRoleName[] | undefined;
}

type DecoratedTarget = Parameters<Reflector['get']>[1];

function readDeclarations(reflector: Reflector, target: DecoratedTarget): Declarations {
  return {
    isPublic: reflector.get<boolean | undefined>(IS_PUBLIC_ROUTE_KEY, target) === true,
    isUserScoped: reflector.get<boolean | undefined>(IS_USER_SCOPED_ROUTE_KEY, target) === true,
    roles: reflector.get<readonly MembershipRoleName[] | undefined>(
      ALLOWED_ROLES_ROUTE_KEY,
      target,
    ),
  };
}

function countDeclarations(declarations: Declarations): number {
  return [
    declarations.isPublic,
    declarations.isUserScoped,
    declarations.roles !== undefined,
  ].filter(Boolean).length;
}

/** Exactamente una declaración válida; cualquier otra cosa es "sin declarar" y se deniega. */
function resolvePolicy(declarations: Declarations): AccessPolicy {
  if (countDeclarations(declarations) !== 1) return { kind: 'undeclared' };
  if (declarations.isPublic) return { kind: 'public' };
  if (declarations.isUserScoped) return { kind: 'user' };

  const roles = declarations.roles ?? [];
  // Una lista vacía no puede significar "cualquiera": es un descuido, no una política.
  return roles.length > 0 ? { kind: 'roles', roles } : { kind: 'undeclared' };
}

/**
 * Lee la política de acceso de una ruta. Lo declarado en el método manda sobre lo declarado en el
 * controlador. Deny by default (SEC-53): sin declaración, o con declaraciones contradictorias,
 * la ruta se deniega en lugar de elegir la opción más permisiva.
 */
export function readAccessPolicy(
  reflector: Reflector,
  handler: DecoratedTarget,
  controllerClass: DecoratedTarget,
): AccessPolicy {
  const handlerDeclarations = readDeclarations(reflector, handler);
  if (countDeclarations(handlerDeclarations) > 0) return resolvePolicy(handlerDeclarations);
  return resolvePolicy(readDeclarations(reflector, controllerClass));
}
