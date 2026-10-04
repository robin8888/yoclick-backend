// @ts-check
/**
 * Reglas de uso de Prisma (SEC-63 y aislamiento entre centros). Fuente única: las usan
 * `eslint.config.js` y el test `prisma-usage-rules.spec.ts`, así que lo que se prueba es lo que se aplica.
 *
 * - El cliente global (`PrismaService`) solo lo toca `src/shared/database`. Una consulta hecha con él
 *   no tiene contexto de centro y la RLS no devuelve filas: hay que pasar por `TenantPrismaService`.
 * - El cliente generado solo se importa en `infrastructure/` (donde se mapea a entidades de dominio)
 *   y en la capa de base de datos; nunca en `domain/` ni en `application/`.
 * - Prohibido el SQL con texto sin parametrizar.
 */

const BASE_RESTRICTED_IMPORT_PATTERNS = [
  {
    regex: '^\\.{1,2}/(.*/)?(utils|helpers|common)$',
    message: 'Nada de ficheros cajón de sastre: nombra el fichero por lo que hace.',
  },
];

const PRISMA_SERVICE_PATTERN = {
  group: ['**/shared/database/prisma.service'],
  message:
    'No uses el cliente global de Prisma: no tiene contexto de centro. Recibe el cliente de la transacción desde TenantPrismaService.',
};

const GENERATED_CLIENT_PATTERN = {
  group: ['**/generated/prisma', '**/generated/prisma/**'],
  message:
    'El cliente generado de Prisma solo se importa en infrastructure/ y se mapea a entidades de dominio.',
};

const TEST_AND_TOOLING_GLOBS = ['prisma/**/*.ts', 'test/**/*.ts', '**/*.spec.ts'];

const GLOBAL_CLIENT_ALLOWED_FILE_GLOBS = ['src/shared/database/**/*.ts', ...TEST_AND_TOOLING_GLOBS];

const GENERATED_CLIENT_ALLOWED_FILE_GLOBS = [
  'src/modules/*/infrastructure/**/*.ts',
  ...GLOBAL_CLIENT_ALLOWED_FILE_GLOBS,
];

const UNSAFE_RAW_QUERY_MESSAGE =
  'Usa $queryRaw/$executeRaw como tagged template (los valores viajan como parámetros) o TypedSQL. Nunca texto concatenado.';

const UNSAFE_RAW_QUERY_SELECTORS = [
  {
    selector: 'MemberExpression > Identifier[name=/^\\$(query|execute)RawUnsafe$/]',
    message: UNSAFE_RAW_QUERY_MESSAGE,
  },
  {
    selector: "CallExpression > MemberExpression[object.name='Prisma'][property.name='raw']",
    message: UNSAFE_RAW_QUERY_MESSAGE,
  },
];

/** Bloques de configuración plana; el último que coincide con un fichero es el que manda. */
function buildPrismaImportRestrictionBlocks() {
  return [
    {
      files: ['**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              ...BASE_RESTRICTED_IMPORT_PATTERNS,
              PRISMA_SERVICE_PATTERN,
              GENERATED_CLIENT_PATTERN,
            ],
          },
        ],
      },
    },
    {
      files: GENERATED_CLIENT_ALLOWED_FILE_GLOBS,
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: [...BASE_RESTRICTED_IMPORT_PATTERNS, PRISMA_SERVICE_PATTERN] },
        ],
      },
    },
    {
      files: GLOBAL_CLIENT_ALLOWED_FILE_GLOBS,
      rules: {
        'no-restricted-imports': ['error', { patterns: [...BASE_RESTRICTED_IMPORT_PATTERNS] }],
      },
    },
  ];
}

module.exports = { buildPrismaImportRestrictionBlocks, UNSAFE_RAW_QUERY_SELECTORS };
