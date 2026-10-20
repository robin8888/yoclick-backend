/**
 * Lo que un centro puede encender o apagar. Un centro de clases lo usa todo; uno de citas (estética,
 * taller, psicología…) solo necesita reservar, anular y cambiar citas, y apaga el resto.
 */
export const CENTER_MODULE_IDS = ['content', 'attendance', 'passes', 'waitlist', 'rooms'] as const;

export type CenterModuleId = (typeof CENTER_MODULE_IDS)[number];

export type CenterModules = Readonly<Record<CenterModuleId, boolean>>;

/** Cambios sobre algunos módulos; un módulo sin valor no cambia. */
export type CenterModuleChanges = { readonly [Id in CenterModuleId]?: boolean | undefined };

/** Cómo trabaja el centro; decide con qué módulos nace. */
export const CENTER_WORK_MODES = ['classes', 'appointments', 'both'] as const;

export type CenterWorkMode = (typeof CENTER_WORK_MODES)[number];

function isCenterModuleId(value: string): value is CenterModuleId {
  return (CENTER_MODULE_IDS as readonly string[]).includes(value);
}

/** Todo encendido salvo lo guardado como apagado; un valor desconocido guardado se ignora. */
export function resolveCenterModules(disabledModules: readonly string[]): CenterModules {
  const disabled = new Set(disabledModules.filter(isCenterModuleId));
  return Object.fromEntries(
    CENTER_MODULE_IDS.map((moduleId) => [moduleId, !disabled.has(moduleId)]),
  ) as Record<CenterModuleId, boolean>;
}

/** Los módulos que se apagan al crear un centro según cómo trabaja. */
export function listDisabledModulesForWorkMode(workMode: CenterWorkMode): CenterModuleId[] {
  return workMode === 'appointments' ? [...CENTER_MODULE_IDS] : [];
}

/** Aplica los cambios de la administración (`{ passes: false }`) a lo que ya estaba apagado. */
export function applyCenterModuleChanges(
  disabledModules: readonly string[],
  changes: CenterModuleChanges,
): CenterModuleId[] {
  const current = resolveCenterModules(disabledModules);
  return CENTER_MODULE_IDS.filter((moduleId) => !(changes[moduleId] ?? current[moduleId]));
}
