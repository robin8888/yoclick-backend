import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type CenterModuleId } from '../../centers/center-modules';
import { CenterModulesFinder } from '../../centers/center-modules.finder';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { type AuthenticatedRequest } from '../authenticated-request';
import { REQUIRED_MODULE_ROUTE_KEY } from '../decorators/requires-module.decorator';

/**
 * Cuarto guard: una ruta marcada con `@RequiresModule()` solo funciona si el centro de quien llama
 * tiene ese módulo encendido. Va después del de tenant, que es quien fija el centro.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly centerModulesFinder: CenterModulesFinder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<CenterModuleId | undefined>(
      REQUIRED_MODULE_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredModule === undefined) return true;

    const { actor } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (actor === undefined) throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);

    const modules = await this.centerModulesFinder.find(actor.centerId);
    if (!modules[requiredModule]) throw new DomainError('MODULE_DISABLED', HTTP_STATUS.conflict);
    return true;
  }
}
