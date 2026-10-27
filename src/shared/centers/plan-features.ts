/**
 * Lo que cada plan incluye, además de los topes de la tabla `platform_plans` (clientes, espacio).
 * Cada plan suma lo del anterior (docs/spec/00-producto.md › Planes y precios). Esta tabla es la
 * única fuente: la API la usa para negar rutas y la app para enseñar qué incluye cada plan.
 */
export const PLAN_IDS = ['basic', 'pro', 'premium'] as const;

export type PlanId = (typeof PLAN_IDS)[number];

/** Funciones que no vienen en todos los planes. Las básicas (reservas, agenda, chat…) no se listan. */
export const PLAN_FEATURE_IDS = [
  'reports',
  'clientImport',
  'routines',
  'contentLibrary',
  'groups',
  'families',
  'waitlist',
  'rooms',
  'customAppearance',
  'videos',
  'onlinePayments',
] as const;

export type PlanFeatureId = (typeof PLAN_FEATURE_IDS)[number];

const PRO_FEATURES: readonly PlanFeatureId[] = [
  'reports',
  'clientImport',
  'routines',
  'contentLibrary',
  'groups',
  'families',
  'waitlist',
  'rooms',
];

const PREMIUM_FEATURES: readonly PlanFeatureId[] = [
  ...PRO_FEATURES,
  'customAppearance',
  'videos',
  'onlinePayments',
];

const FEATURES_BY_PLAN: Readonly<Record<PlanId, readonly PlanFeatureId[]>> = {
  basic: [],
  pro: PRO_FEATURES,
  premium: PREMIUM_FEATURES,
};

function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/** Un plan desconocido no da nada extra: lo seguro ante un dato raro es no abrir funciones. */
export function listPlanFeatures(planId: string): readonly PlanFeatureId[] {
  return isPlanId(planId) ? FEATURES_BY_PLAN[planId] : [];
}

export function doesPlanIncludeFeature(planId: string, feature: PlanFeatureId): boolean {
  return listPlanFeatures(planId).includes(feature);
}
