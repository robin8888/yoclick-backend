/**
 * Biblioteca de ejercicios de cada tipo de centro (docs/design/prototipo-yoclick.html, objeto SECTORS).
 * Es el punto de partida del constructor de rutinas: el centro puede añadir ejercicios propios, que
 * viven solo en sus rutinas.
 */
export interface LibraryExercise {
  readonly name: string;
  readonly category: string;
}

const FITNESS_EXERCISES: readonly LibraryExercise[] = [
  { name: 'Sentadilla goblet', category: 'Piernas' },
  { name: 'Peso muerto rumano', category: 'Piernas' },
  { name: 'Zancada búlgara', category: 'Piernas' },
  { name: 'Press banca con mancuernas', category: 'Empuje' },
  { name: 'Remo con mancuerna', category: 'Tracción' },
  { name: 'Dominada asistida', category: 'Tracción' },
  { name: 'Plancha frontal', category: 'Core' },
  { name: 'Dead bug', category: 'Core' },
  { name: 'Puente de glúteo', category: 'Piernas' },
  { name: 'Press militar', category: 'Empuje' },
  { name: 'Face pull', category: 'Tracción' },
  { name: 'Pallof press', category: 'Core' },
];

export const EXERCISE_LIBRARY_BY_SECTOR: Readonly<Record<string, readonly LibraryExercise[]>> = {
  gym: FITNESS_EXERCISES,
  estudio: FITNESS_EXERCISES,
  readap: FITNESS_EXERCISES,
  box: FITNESS_EXERCISES,
  yoga: [
    { name: 'Saludo al sol A', category: 'Secuencias' },
    { name: 'Guerrero II', category: 'Posturas' },
    { name: 'Triángulo', category: 'Posturas' },
    { name: 'Plancha lateral', category: 'Core' },
    { name: 'The hundred', category: 'Core' },
    { name: 'Ujjayi', category: 'Respiración' },
    { name: 'Nadi shodhana', category: 'Respiración' },
    { name: 'Savasana', category: 'Relajación' },
  ],
  academia: [
    { name: 'Present perfect', category: 'Inglés' },
    { name: 'Phrasal verbs', category: 'Inglés' },
    { name: 'Ecuaciones de 2º grado', category: 'Matemáticas' },
    { name: 'Fracciones', category: 'Matemáticas' },
    { name: 'Comentario de texto', category: 'Lengua' },
    { name: 'Simulacro de examen', category: 'Exámenes' },
    { name: 'Tema 5 del temario', category: 'Oposiciones' },
    { name: 'Test tipo', category: 'Oposiciones' },
  ],
  baile: [
    { name: 'Paso básico de salsa', category: 'Salsa' },
    { name: 'Dile que no', category: 'Salsa' },
    { name: 'Cross body lead', category: 'Salsa' },
    { name: 'Paso básico de bachata', category: 'Bachata' },
    { name: 'Sensual wave', category: 'Bachata' },
    { name: 'Braceo', category: 'Flamenco' },
    { name: 'Zapateado básico', category: 'Flamenco' },
    { name: 'Giros y equilibrio', category: 'Técnica' },
  ],
  marciales: [
    { name: 'Oi-zuki', category: 'Kihon' },
    { name: 'Gyaku-zuki', category: 'Kihon' },
    { name: 'Mae-geri', category: 'Kihon' },
    { name: 'Heian Shodan', category: 'Kata' },
    { name: 'Heian Nidan', category: 'Kata' },
    { name: 'Kumite básico', category: 'Combate' },
    { name: 'Caídas (ukemi)', category: 'Técnica' },
    { name: 'Comba y agilidad', category: 'Físico' },
  ],
  musica: [
    { name: 'Escala de Do mayor', category: 'Técnica' },
    { name: 'Arpegios', category: 'Técnica' },
    { name: 'Acordes abiertos', category: 'Guitarra' },
    { name: 'Cejilla en Fa', category: 'Guitarra' },
    { name: 'Hanon n.º 1', category: 'Piano' },
    { name: 'Vocalización', category: 'Canto' },
    { name: 'Lectura rítmica', category: 'Lenguaje' },
    { name: 'Dictado melódico', category: 'Lenguaje' },
  ],
  cocina: [
    { name: 'Corte en brunoise', category: 'Técnicas' },
    { name: 'Fondo oscuro', category: 'Técnicas' },
    { name: 'Masa madre', category: 'Panadería' },
    { name: 'Pan de molde', category: 'Panadería' },
    { name: 'Crema pastelera', category: 'Repostería' },
    { name: 'Masa quebrada', category: 'Repostería' },
    { name: 'Arroz para sushi', category: 'Mundo' },
    { name: 'Ramen casero', category: 'Mundo' },
  ],
  otro: [
    { name: 'Guía de bienvenida', category: 'General' },
    { name: 'Normas del centro', category: 'General' },
    { name: 'Vídeo introductorio', category: 'Vídeos' },
    { name: 'Clase grabada', category: 'Vídeos' },
    { name: 'Plan de 4 semanas', category: 'Guías' },
    { name: 'Preguntas frecuentes', category: 'Guías' },
    { name: 'Checklist', category: 'General' },
    { name: 'Ficha de seguimiento', category: 'Guías' },
  ],
};

/** Un tipo de centro desconocido usa la biblioteca de «otro». */
export function getExerciseLibrary(sectorId: string): readonly LibraryExercise[] {
  return EXERCISE_LIBRARY_BY_SECTOR[sectorId] ?? EXERCISE_LIBRARY_BY_SECTOR['otro'] ?? [];
}
