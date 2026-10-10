/** Fondo y colmena que personaliza un centro Premium. Todo nulo = los del tema de la app. */
export interface CenterAppearance {
  readonly backgroundColor: string | null;
  /** Segundo color del degradado; nulo = fondo liso. */
  readonly backgroundColorEnd: string | null;
  readonly hiveColor: string | null;
}

export interface CenterAppearanceSource extends CenterAppearance {
  readonly maxClients: number | null;
}

const NO_APPEARANCE: CenterAppearance = {
  backgroundColor: null,
  backgroundColorEnd: null,
  hiveColor: null,
};

/** El plan Premium es el único sin tope de clientes (docs/spec/00-producto.md › Planes). */
export function isPremiumPlan(maxClients: number | null): boolean {
  return maxClients === null;
}

/**
 * Lo que ven las personas del centro: si el plan baja de Premium, lo guardado se conserva pero deja
 * de aplicarse, así que al volver a Premium el propietario no tiene que elegirlo otra vez.
 */
export function resolveVisibleAppearance(center: CenterAppearanceSource): CenterAppearance {
  if (!isPremiumPlan(center.maxClients)) return NO_APPEARANCE;
  return {
    backgroundColor: center.backgroundColor,
    backgroundColorEnd: center.backgroundColorEnd,
    hiveColor: center.hiveColor,
  };
}
