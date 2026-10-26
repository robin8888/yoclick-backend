import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, mergeMap } from 'rxjs';
import { type AuthenticatedRequest } from '../../../shared/auth/authenticated-request';
import { PushDispatcher } from '../application/push-dispatcher';

const READ_ONLY_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Tras cualquier cambio confirmado dentro de un centro, envía al móvil los avisos que ese cambio
 * haya dejado escritos. Así ninguna ruta nueva tiene que acordarse de pedir el envío: si guarda un
 * aviso, la persona recibe el push. El envío nunca rompe la respuesta (lo garantiza el dispatcher)
 * y repetirlo es inocuo: solo se envía lo que aún no se había enviado.
 */
@Injectable()
export class PushAfterMutationInterceptor implements NestInterceptor {
  constructor(private readonly dispatcher: PushDispatcher) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { actor } = request;
    if (actor === undefined || READ_ONLY_METHODS.has(request.method)) return next.handle();
    return next.handle().pipe(
      mergeMap(async (response: unknown) => {
        await this.dispatcher.flushCenter(actor);
        return response;
      }),
    );
  }
}
