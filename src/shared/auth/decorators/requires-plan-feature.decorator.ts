import { SetMetadata } from '@nestjs/common';
import { type PlanFeatureId } from '../../centers/plan-features';

export const REQUIRED_PLAN_FEATURE_ROUTE_KEY = 'access-policy:plan-feature';
export const ALLOW_WITHOUT_PLAN_ROUTE_KEY = 'access-policy:allow-without-plan';

/**
 * La ruta solo existe si el plan del centro incluye esa función; si no, responde 402
 * `PLAN_FEATURE_NOT_INCLUDED`. La app esconde lo que el plan no da, pero quien lo impide es la API.
 */
export const RequiresPlanFeature = (feature: PlanFeatureId): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PLAN_FEATURE_ROUTE_KEY, feature);

/**
 * Un centro que debe contratar un plan no puede cambiar nada, salvo estas rutas: elegir y pagar el
 * plan, ver su estado y lo que no es del centro (avisos, móviles registrados).
 */
export const AllowWithoutPlan = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WITHOUT_PLAN_ROUTE_KEY, true);
