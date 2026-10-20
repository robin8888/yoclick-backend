import { SetMetadata } from '@nestjs/common';
import { type CenterModuleId } from '../../centers/center-modules';

export const REQUIRED_MODULE_ROUTE_KEY = 'access-policy:module';

/**
 * La ruta solo existe si el centro tiene ese módulo encendido; si lo apagó, responde 409
 * `MODULE_DISABLED`. La app esconde lo apagado, pero quien lo impide es la API. Se pone junto a
 * `@Roles()`, en el método o en el controlador entero.
 */
export const RequiresModule = (moduleId: CenterModuleId): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_MODULE_ROUTE_KEY, moduleId);
