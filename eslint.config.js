// @ts-check
/**
 * ESLint 9 (flat config) con las reglas de docs/spec/06-clean-code.md.
 * La prohibición del PrismaClient global y del SQL sin parametrizar vive en
 * eslint/prisma-usage-rules.js. Los límites entre capas (boundaries) llegan con los primeros módulos.
 */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');
const sonarjs = require('eslint-plugin-sonarjs');
const {
  buildPrismaImportRestrictionBlocks,
  UNSAFE_RAW_QUERY_SELECTORS,
} = require('./eslint/prisma-usage-rules');

const FORBIDDEN_VAGUE_IDENTIFIERS = [
  'data',
  'info',
  'tmp',
  'temp',
  'obj',
  'val',
  'res',
  'arr',
  'foo',
  'bar',
  'item2',
  'handle',
  'process',
  'doIt',
];

/**
 * Prohíbe estos nombres al DECLARAR variables, parámetros, funciones y propiedades de clase.
 * No se usa `id-denylist` porque también marcaría claves de objeto que impone una librería
 * (`data` en Prisma, `res` en pino), que no son una decisión nuestra.
 */
const NOT_A_VAGUE_NAME = {
  regex: `^(${FORBIDDEN_VAGUE_IDENTIFIERS.join('|')})$`,
  match: false,
};

const MAX_LINES_PER_FUNCTION = 40;
const MAX_PARAMETERS = 3;
const MAX_NESTING_DEPTH = 3;
const MAX_CYCLOMATIC_COMPLEXITY = 10;

module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.js',
      'prisma/migrations/**',
      'src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  sonarjs.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Nest crea clases solo con decoradores (módulos, controladores).
      '@typescript-eslint/no-extraneous-class': 'off',
      // Los constructores con `private readonly` son la forma idiomática de inyectar en Nest.
      '@typescript-eslint/parameter-properties': 'off',

      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE'],
          custom: NOT_A_VAGUE_NAME,
        },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'are', 'has', 'have', 'can', 'should', 'was', 'were', 'will'],
        },
        { selector: 'function', format: ['camelCase'], custom: NOT_A_VAGUE_NAME },
        // Los decoradores de Nest (`@Public()`, `@Roles()`) son funciones con nombre en PascalCase.
        {
          selector: 'variable',
          types: ['function'],
          format: ['camelCase', 'PascalCase'],
          custom: NOT_A_VAGUE_NAME,
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          custom: NOT_A_VAGUE_NAME,
        },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase'] },
        // Claves que impone una librería o un protocolo (`data` de Prisma, cabeceras HTTP, JSON de terceros).
        { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
        {
          selector: 'classProperty',
          format: ['camelCase', 'UPPER_CASE'],
          custom: NOT_A_VAGUE_NAME,
        },
        { selector: 'import', format: null },
      ],

      'id-length': ['error', { min: 2, exceptions: ['_'] }],
      'max-lines-per-function': [
        'error',
        { max: MAX_LINES_PER_FUNCTION, skipBlankLines: true, skipComments: true },
      ],
      'max-params': ['error', MAX_PARAMETERS],
      'max-depth': ['error', MAX_NESTING_DEPTH],
      complexity: ['error', MAX_CYCLOMATIC_COMPLEXITY],
      'no-magic-numbers': [
        'error',
        { ignore: [0, 1, -1], ignoreArrayIndexes: true, enforceConst: true },
      ],
      'no-console': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': ['error', ...UNSAFE_RAW_QUERY_SELECTORS],
    },
  },

  // Quién puede importar Prisma y qué ficheros se consideran cajón de sastre.
  ...buildPrismaImportRestrictionBlocks(),

  {
    // En tests los números y los nombres de dobles de prueba son parte del caso.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      'no-magic-numbers': 'off',
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Los fixtures usan contraseñas falsas a propósito.
      'sonarjs/no-hardcoded-passwords': 'off',
      // Los matchers asimétricos de Jest (`expect.stringMatching`) devuelven `any`.
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  {
    // Un caso de uso recibe por inyección sus puertos (repositorios, hasher, correo...): hasta 5.
    // Si necesita más, está haciendo demasiado y hay que partirlo. Las funciones siguen en 3.
    files: ['src/**/*.use-case.ts', 'src/**/*.controller.ts', 'src/**/application/*.ts'],
    rules: { 'max-params': ['error', 5] },
  },

  {
    // Seeds de desarrollo: imprimen por consola y usan la contraseña de demo, públicamente conocida.
    files: ['prisma/**/*.ts'],
    rules: { 'no-console': 'off', 'sonarjs/no-hardcoded-passwords': 'off' },
  },
);
