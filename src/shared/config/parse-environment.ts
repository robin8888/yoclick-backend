import { type Environment, environmentSchema } from './environment.schema';

export class EnvironmentValidationError extends Error {
  constructor(invalidVariableDescriptions: string[]) {
    super(`Invalid environment configuration:\n${invalidVariableDescriptions.join('\n')}`);
    this.name = 'EnvironmentValidationError';
  }
}

/**
 * Valida y tipa las variables de entorno. Falla al arrancar con todos los
 * problemas a la vez y sin repetir los valores recibidos: podrían ser secretos.
 */
export function parseEnvironment(rawEnvironment: Record<string, unknown>): Environment {
  const parsingResult = environmentSchema.safeParse(rawEnvironment);
  if (parsingResult.success) return parsingResult.data;

  const invalidVariableDescriptions = parsingResult.error.issues.map(
    (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
  );
  throw new EnvironmentValidationError(invalidVariableDescriptions);
}
