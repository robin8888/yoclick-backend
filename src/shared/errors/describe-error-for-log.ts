const MAX_STACK_FRAMES = 10;

export interface ErrorLogDescription {
  readonly errorName: string;
  readonly errorCode?: string;
  readonly stackFrames: readonly string[];
}

function readStringCode(error: Error): string | undefined {
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Qué se registra de un error inesperado: nombre, código y fotogramas de la pila.
 * NO el mensaje: los errores de base de datos y de librerías pueden incluir valores
 * (emails, ids, consultas) y los logs no deben contener datos personales (SEC-25, SEC-72).
 */
export function describeErrorForLog(error: unknown): ErrorLogDescription {
  if (!(error instanceof Error)) return { errorName: 'NonErrorThrown', stackFrames: [] };

  const errorCode = readStringCode(error);
  const stackFrames = (error.stack ?? '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, MAX_STACK_FRAMES);

  return { errorName: error.name, ...(errorCode && { errorCode }), stackFrames };
}
