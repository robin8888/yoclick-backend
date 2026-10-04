import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { type ActorContext } from '../tenancy/actor-context';
import { PrismaService } from './prisma.service';

/** Cliente de una transacción con el contexto de tenant ya fijado. Es lo único que reciben los repositorios. */
export type TenantTransactionClient = Prisma.TransactionClient;

const TRANSACTION_MAX_WAIT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 10_000;
/** Menor que el timeout de la transacción: la consulta lenta falla antes de agotar la conexión (SEC-52). */
const STATEMENT_TIMEOUT_MS = 5_000;

interface RequestContextSettings {
  readonly centerId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly role: string;
}

const NO_CENTER_SETTINGS: Pick<RequestContextSettings, 'centerId' | 'membershipId' | 'role'> = {
  centerId: '',
  membershipId: '',
  role: '',
};

/**
 * Ejecuta trabajo de base de datos dentro de una transacción con el contexto de la petición.
 *
 * `set_config(..., true)` hace el valor local a la transacción: al terminar desaparece, así que
 * es seguro con pool de conexiones y con PgBouncer en modo transacción. Las políticas RLS leen
 * estos valores; sin ellos no devuelven ninguna fila (deny by default).
 *
 * Los valores viajan como parámetros del tagged template: nunca se concatenan en el SQL.
 */
@Injectable()
export class TenantPrismaService {
  constructor(private readonly prismaService: PrismaService) {}

  /** Para endpoints de un centro: el actor ya fue verificado contra sus membresías. */
  async runInTenantContext<TResult>(
    actor: ActorContext,
    work: (transactionClient: TenantTransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    return this.runWithSettings(
      {
        centerId: actor.centerId,
        userId: actor.userId,
        membershipId: actor.membershipId,
        role: actor.role,
      },
      work,
    );
  }

  /** Para endpoints de la propia persona (`/me/*`), que no pertenecen a ningún centro concreto. */
  async runInUserContext<TResult>(
    userId: string,
    work: (transactionClient: TenantTransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    return this.runWithSettings({ ...NO_CENTER_SETTINGS, userId }, work);
  }

  private async runWithSettings<TResult>(
    settings: RequestContextSettings,
    work: (transactionClient: TenantTransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prismaService.$transaction(
      async (transactionClient) => {
        await this.applySettings(transactionClient, settings);
        return work(transactionClient);
      },
      { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  private async applySettings(
    transactionClient: TenantTransactionClient,
    settings: RequestContextSettings,
  ): Promise<void> {
    await transactionClient.$queryRaw`
      select
        set_config('app.center_id', ${settings.centerId}, true),
        set_config('app.user_id', ${settings.userId}, true),
        set_config('app.membership_id', ${settings.membershipId}, true),
        set_config('app.role', ${settings.role}, true),
        set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`;
  }
}
