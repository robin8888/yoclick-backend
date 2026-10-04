import { execFileSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';
import { assertIsTestDatabase, readRequiredEnvironmentVariable } from './support/test-database';

/** Deja la base de tests con todas las migraciones aplicadas antes de ejecutar la suite e2e. */
export default function migrateTestDatabase(): void {
  loadDotenv({ quiet: true });
  const migrationUrl = readRequiredEnvironmentVariable('TEST_MIGRATION_DATABASE_URL');
  assertIsTestDatabase(migrationUrl);

  // Se lanza el CLI de Prisma con el mismo Node, sin shell ni búsqueda en el PATH.
  const prismaCliPath = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCliPath, 'migrate', 'deploy'], {
    stdio: 'pipe',
    env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl },
  });
}
