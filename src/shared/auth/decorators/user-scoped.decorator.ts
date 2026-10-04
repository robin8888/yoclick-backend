import { SetMetadata } from '@nestjs/common';

export const IS_USER_SCOPED_ROUTE_KEY = 'access-policy:user-scoped';

/**
 * Ruta de la propia persona (`/me/*`, `/join/*`): basta con estar autenticada, no pertenece a un
 * centro concreto y no lleva `X-Center-Id`. Solo debe tocar datos de esa persona.
 */
export const UserScoped = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_USER_SCOPED_ROUTE_KEY, true);
