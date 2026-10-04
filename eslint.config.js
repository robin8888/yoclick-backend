// @ts-check
/**
 * ESLint 9 (flat config) con las reglas de docs/spec/06-clean-code.md.
 * Los límites entre capas (boundaries) y la prohibición del PrismaClient global
 * se añaden en API-004, cuando existen los módulos que protegen.
 */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');
const sonarjs = require('eslint-plugin-sonarjs');

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

const MAX_LINES_PER_FUNCTION = 40;
const MAX_PARAMETERS = 3;
const MAX_NESTING_DEPTH = 3;
const MAX_CYCLOMATIC_COMPLEXITY = 10;

module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.js', 'prisma/migrations/**'] },

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
        },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'can', 'should', 'was', 'will'],
        },
        { selector: 'function', format: ['camelCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase'] },
        // Cabeceras HTTP, claves de JSON de terceros, etc.
        { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
        { selector: 'classProperty', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'import', format: null },
      ],

      'id-denylist': ['error', ...FORBIDDEN_VAGUE_IDENTIFIERS],
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
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/(.*/)?(utils|helpers|common)$',
              message: 'Nada de ficheros cajón de sastre: nombra el fichero por lo que hace.',
            },
          ],
        },
      ],
    },
  },

  {
    // En tests los números y los nombres de dobles de prueba son parte del caso.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      'no-magic-numbers': 'off',
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['prisma/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
