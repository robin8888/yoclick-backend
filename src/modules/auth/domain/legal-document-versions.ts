/**
 * Versión vigente de cada texto legal. Al registrarse se guarda la que la persona aceptó (RGPD: poder
 * probar QUÉ aceptó y CUÁNDO). Cada vez que cambie un texto, se sube su versión aquí.
 *
 * Los textos reales los redacta y revisa el titular con su abogado (ver PENDIENTE de la tienda):
 * estas fechas son las de los borradores.
 */
export const LEGAL_DOCUMENT_VERSIONS = {
  privacy: '2026-10-01',
  terms: '2026-10-01',
  marketing: '2026-10-01',
} as const;
