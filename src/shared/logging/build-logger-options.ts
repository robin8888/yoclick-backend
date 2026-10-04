import { type Params } from 'nestjs-pino';
import { type Environment } from '../config/environment.schema';
import { LOG_REDACTION, serializeRequestForLog } from './log-redaction';

type LoggerEnvironment = Pick<Environment, 'NODE_ENV' | 'LOG_LEVEL'>;

export function buildLoggerOptions(environment: LoggerEnvironment): Params {
  const isDevelopment = environment.NODE_ENV === 'development';

  return {
    pinoHttp: {
      level: environment.LOG_LEVEL,
      redact: LOG_REDACTION,
      serializers: {
        req: serializeRequestForLog,
        // `res` es el nombre que fija pino para el serializador de respuestas.
        res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode }),
      },
      ...(isDevelopment && { transport: { target: 'pino-pretty' } }),
    },
  };
}
