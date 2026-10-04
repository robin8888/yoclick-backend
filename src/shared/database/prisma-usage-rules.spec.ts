import { ESLint } from 'eslint';
import * as typescriptParser from '@typescript-eslint/parser';
import {
  buildPrismaImportRestrictionBlocks,
  UNSAFE_RAW_QUERY_SELECTORS,
} from '../../../eslint/prisma-usage-rules';

/**
 * Lint con las MISMAS reglas que usa eslint.config.js, sin reglas con tipos,
 * para comprobar qué ficheros pueden tocar Prisma y cuáles no.
 */
async function lintSource(sourceCode: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: typescriptParser },
        rules: { 'no-restricted-syntax': ['error', ...UNSAFE_RAW_QUERY_SELECTORS] },
      },
      ...buildPrismaImportRestrictionBlocks(),
    ],
  });
  const [result] = await eslint.lintText(sourceCode, { filePath });
  return (result?.messages ?? []).map((message) => message.message);
}

describe('Prisma usage rules (SEC-63, tenant isolation)', () => {
  it('fails a repository that imports the global PrismaService', async () => {
    const messages = await lintSource(
      "import { PrismaService } from '../../../shared/database/prisma.service';",
      'src/modules/bookings/infrastructure/prisma-booking.repository.ts',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('TenantPrismaService');
  });

  it('fails a use case that imports the generated Prisma client', async () => {
    const messages = await lintSource(
      "import { PrismaClient } from '../../../generated/prisma/client';",
      'src/modules/bookings/application/create-booking.use-case.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('fails the domain layer that imports the generated Prisma client', async () => {
    const messages = await lintSource(
      "import { type Booking } from '../../../generated/prisma/client';",
      'src/modules/bookings/domain/booking.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it.each([
    {
      case: 'infrastructure code importing the generated types it maps to the domain',
      source: "import { type Booking } from '../../../generated/prisma/client';",
      filePath: 'src/modules/bookings/infrastructure/prisma-booking.repository.ts',
    },
    {
      case: 'the database module building the global client',
      source: "import { PrismaClient } from '../../generated/prisma/client';",
      filePath: 'src/shared/database/prisma.service.ts',
    },
    {
      case: 'a repository receiving the tenant transaction client type',
      source:
        "import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';",
      filePath: 'src/modules/bookings/infrastructure/prisma-booking.repository.ts',
    },
  ])('allows $case', async ({ source, filePath }) => {
    const messages = await lintSource(source, filePath);

    expect(messages).toEqual([]);
  });

  it.each(['$queryRawUnsafe', '$executeRawUnsafe'])(
    'forbids %s everywhere',
    async (unsafeMethod) => {
      const messages = await lintSource(
        `client.${unsafeMethod}('select 1');`,
        'src/modules/bookings/infrastructure/prisma-booking.repository.ts',
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('tagged template');
    },
  );

  it('forbids Prisma.raw, which injects text into SQL without parameters', async () => {
    const messages = await lintSource(
      'const fragment = Prisma.raw(userInput);',
      'src/modules/bookings/infrastructure/prisma-booking.repository.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('allows the safe tagged template form', async () => {
    const messages = await lintSource(
      'client.$queryRaw`select 1`;',
      'src/modules/bookings/infrastructure/prisma-booking.repository.ts',
    );

    expect(messages).toEqual([]);
  });
});
