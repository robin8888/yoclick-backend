import { z } from 'zod';

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const DEFAULT_PORT = 3000;

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
const VERBOSE_LOG_LEVELS: readonly string[] = ['trace', 'debug'];

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // En contenedor hay que poner 0.0.0.0 de forma explícita; por defecto no se expone a la red.
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(MIN_TCP_PORT).max(MAX_TCP_PORT).default(DEFAULT_PORT),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  })
  .superRefine((environment, context) => {
    const isProduction = environment.NODE_ENV === 'production';
    if (isProduction && VERBOSE_LOG_LEVELS.includes(environment.LOG_LEVEL)) {
      context.addIssue({
        code: 'custom',
        path: ['LOG_LEVEL'],
        message: 'must be info or higher in production (verbose logs can leak data)',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;
