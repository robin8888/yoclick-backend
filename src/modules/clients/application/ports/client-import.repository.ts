import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type ImportRow } from '../../domain/client-import-rules';

/**
 * - `created`: pasa a ser cliente del centro (con cuenta nueva sin activar si no la tenía).
 * - `updated`: ya era cliente activo; se actualiza su nivel si el archivo trae uno.
 * - `blocked`: el centro la tiene bloqueada; no se toca.
 * - `team_member`: ya forma parte del equipo; su rol no cambia por una importación.
 * - `client_limit_reached`: el plan no admite más clientes.
 */
export type ImportRowOutcome =
  'created' | 'updated' | 'blocked' | 'team_member' | 'client_limit_reached';

export interface ImportedRowResult {
  readonly email: string;
  readonly outcome: ImportRowOutcome;
}

export interface ClientImportRepository {
  /** Todo en una transacción con el centro bloqueado: el tope de clientes no se salta con dos importaciones a la vez. */
  importClients(
    actor: ActorContext,
    rows: readonly ImportRow[],
  ): Promise<readonly ImportedRowResult[]>;
}

export const CLIENT_IMPORT_REPOSITORY = Symbol('CLIENT_IMPORT_REPOSITORY');
