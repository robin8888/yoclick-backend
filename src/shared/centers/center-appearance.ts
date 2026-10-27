import { doesPlanIncludeFeature } from './plan-features';

/** Fondo y colmena que personaliza un centro Premium. Todo nulo = los del tema de la app. */
export interface CenterAppearance {
  readonly backgroundColor: string | null;
  /** Segundo color del degradado; nulo = fondo liso. */
  readonly backgroundColorEnd: string | null;
  readonly hiveColor: string | null;
}

export interface CenterAppearanceSource extends CenterAppearance {
  readonly planId: string;
}

const NO_APPEARANCE: CenterAppearance = {
  backgroundColor: null,
  backgroundColorEnd: null,
  hiveColor: null,
};

/** Solo los planes que incluyen `customAppearance` (el Premium) pueden personalizar el fondo y la colmena. */
export function canPlanCustomizeAppearance(planId: string): boolean {
  return doesPlanIncludeFeature(planId, 'customAppearance');
}

/**
 * Lo que ven las personas del centro: si el plan baja de Premium, lo guardado se conserva pero deja
 * de aplicarse, así que al volver a Premium el propietario no tiene que elegirlo otra vez.
 */
export function resolveVisibleAppearance(center: CenterAppearanceSource): CenterAppearance {
  if (!canPlanCustomizeAppearance(center.planId)) return NO_APPEARANCE;
  return {
    backgroundColor: center.backgroundColor,
    backgroundColorEnd: center.backgroundColorEnd,
    hiveColor: center.hiveColor,
  };
}
