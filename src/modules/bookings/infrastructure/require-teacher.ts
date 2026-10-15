/**
 * Las reservas solo existen sobre sesiones con profesor (un disparador de la base de datos impide
 * reservar un alquiler), así que aquí un profesor ausente es un fallo de datos, no un caso normal.
 */
export function requireTeacher<TeacherRecord>(teacher: TeacherRecord | null): TeacherRecord {
  if (teacher === null) throw new Error('A booked session must have a teacher');
  return teacher;
}
