const DAY_MS = 86_400_000;
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

/** La fecha de hoy en la zona horaria del centro, `YYYY-MM-DD`: el «hoy» de quien llama no es el de UTC. */
export function formatLocalDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, ISO_DATE_LENGTH);
}

/** Cómo se lo lee el bot a quien llama: «martes 3 de noviembre a las 17:30», en la hora del centro. */
export function describeLocalInstant(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}
