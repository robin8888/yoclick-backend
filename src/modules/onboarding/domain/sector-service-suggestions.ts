export interface SuggestedService {
  readonly name: string;
  readonly durationMinutes: number;
}

type SectorId =
  | 'gym'
  | 'estudio'
  | 'readap'
  | 'box'
  | 'yoga'
  | 'academia'
  | 'baile'
  | 'marciales'
  | 'musica'
  | 'cocina'
  | 'otro';

/**
 * Servicios con los que arranca un centro nuevo según su sector (campo `svcs` de `SECTORS` en el
 * prototipo). Todos se crean como individuales: aunque el nombre suene a clase en grupo
 * («WOD en grupo», «Clase dirigida»), los grupos llegan después y el centro puede editarlos.
 */
export const SECTOR_SERVICE_SUGGESTIONS: Readonly<Record<SectorId, readonly SuggestedService[]>> = {
  gym: [
    { name: 'Entrenamiento personal', durationMinutes: 60 },
    { name: 'Clase dirigida', durationMinutes: 50 },
    { name: 'Valoración inicial', durationMinutes: 30 },
    { name: 'Grupo reducido', durationMinutes: 50 },
  ],
  estudio: [
    { name: 'Entrenamiento personal', durationMinutes: 60 },
    { name: 'Valoración inicial', durationMinutes: 30 },
    { name: 'Entrenamiento en pareja', durationMinutes: 60 },
    { name: 'Clase reducida (máx. 4)', durationMinutes: 50 },
  ],
  readap: [
    { name: 'Sesión de readaptación', durationMinutes: 50 },
    { name: 'Fisioterapia', durationMinutes: 45 },
    { name: 'Evaluación funcional', durationMinutes: 40 },
    { name: 'Entrenamiento terapéutico', durationMinutes: 60 },
  ],
  box: [
    { name: 'WOD en grupo', durationMinutes: 60 },
    { name: 'Open box', durationMinutes: 60 },
    { name: 'Halterofilia', durationMinutes: 60 },
    { name: 'Iniciación', durationMinutes: 45 },
  ],
  yoga: [
    { name: 'Hatha yoga', durationMinutes: 60 },
    { name: 'Vinyasa', durationMinutes: 60 },
    { name: 'Pilates máquina', durationMinutes: 50 },
    { name: 'Clase privada', durationMinutes: 60 },
  ],
  academia: [
    { name: 'Inglés B1 · grupo', durationMinutes: 90 },
    { name: 'Refuerzo de matemáticas', durationMinutes: 60 },
    { name: 'Clase particular', durationMinutes: 60 },
    { name: 'Simulacro de examen', durationMinutes: 120 },
  ],
  baile: [
    { name: 'Salsa · iniciación', durationMinutes: 60 },
    { name: 'Bachata · intermedio', durationMinutes: 60 },
    { name: 'Flamenco', durationMinutes: 90 },
    { name: 'Clase particular', durationMinutes: 45 },
  ],
  marciales: [
    { name: 'Karate infantil', durationMinutes: 60 },
    { name: 'Karate adultos', durationMinutes: 75 },
    { name: 'Kickboxing', durationMinutes: 60 },
    { name: 'Clase particular', durationMinutes: 60 },
  ],
  musica: [
    { name: 'Guitarra · individual', durationMinutes: 45 },
    { name: 'Piano · individual', durationMinutes: 45 },
    { name: 'Canto', durationMinutes: 45 },
    { name: 'Lenguaje musical en grupo', durationMinutes: 60 },
  ],
  cocina: [
    { name: 'Cocina básica', durationMinutes: 120 },
    { name: 'Panadería y masas', durationMinutes: 180 },
    { name: 'Repostería', durationMinutes: 150 },
    { name: 'Taller de sushi', durationMinutes: 120 },
  ],
  otro: [
    { name: 'Clase individual', durationMinutes: 60 },
    { name: 'Clase en grupo', durationMinutes: 60 },
    { name: 'Primera visita', durationMinutes: 30 },
    { name: 'Taller', durationMinutes: 120 },
  ],
};

/** Un sector desconocido (por ejemplo, de una versión futura) arranca como «otro» en vez de sin servicios. */
export function suggestServicesForSector(sectorId: string): readonly SuggestedService[] {
  const isKnownSector = Object.hasOwn(SECTOR_SERVICE_SUGGESTIONS, sectorId);
  return SECTOR_SERVICE_SUGGESTIONS[isKnownSector ? (sectorId as SectorId) : 'otro'];
}
