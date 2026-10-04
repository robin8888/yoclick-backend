import { type Environment } from '../shared/config/environment.schema';

/** SEC-61: la documentación interactiva no se sirve en producción. El `openapi.yaml` sí se publica como artefacto. */
export function shouldExposeApiDocs(nodeEnv: Environment['NODE_ENV']): boolean {
  return nodeEnv !== 'production';
}
