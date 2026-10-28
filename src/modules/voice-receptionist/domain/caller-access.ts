/** A quién se dirige el bot: un centro con bonos tiene alumnos; los demás, clientes. */
export type CallerAudience = 'student' | 'client';

/** El centro usa bonos cuando no ha apagado ese módulo. */
export function doesCenterUsePasses(disabledModules: readonly string[]): boolean {
  return !disabledModules.includes('passes');
}

export function determineCallerAudience(disabledModules: readonly string[]): CallerAudience {
  return doesCenterUsePasses(disabledModules) ? 'student' : 'client';
}

/**
 * Qué servicios puede reservar por teléfono quien no es alumno ni cliente:
 * - en un centro con bonos, solo los que el centro marca como cita de prueba (el invitado no tiene bono);
 * - en un centro sin bonos (peluquería, estética…), cualquiera: reservar es libre.
 */
export function canGuestBookService(input: {
  readonly disabledModules: readonly string[];
  readonly serviceAllowsTrialBookings: boolean;
}): boolean {
  return !doesCenterUsePasses(input.disabledModules) || input.serviceAllowsTrialBookings;
}
