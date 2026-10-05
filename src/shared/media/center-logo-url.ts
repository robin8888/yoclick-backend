/**
 * Ruta relativa pública del logo de un centro, o `null` si no tiene. El parámetro `v` (instante de
 * subida en milisegundos) cambia al subir otro logo y rompe la caché del cliente. Es el único sitio
 * donde se define este formato.
 */
export function buildCenterLogoUrl(centerId: string, logoUpdatedAt: Date): string;
export function buildCenterLogoUrl(centerId: string, logoUpdatedAt: Date | null): string | null;
export function buildCenterLogoUrl(centerId: string, logoUpdatedAt: Date | null): string | null {
  if (logoUpdatedAt === null) return null;
  return `/v1/centers/${centerId}/logo?v=${String(logoUpdatedAt.getTime())}`;
}
