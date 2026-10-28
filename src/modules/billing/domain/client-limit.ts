export interface ClientLoad {
  readonly activeClientCount: number;
  /** Tope del plan; `null` = sin tope. */
  readonly maxClients: number | null;
}

/**
 * Un centro está por encima del tope cuando tiene más clientes activos que los que admite su plan. Solo
 * frena las altas nuevas: nadie que ya esté dentro pierde el acceso. Llegar justo al tope no cuenta.
 */
export function isOverClientLimit(load: ClientLoad): boolean {
  return load.maxClients !== null && load.activeClientCount > load.maxClients;
}
