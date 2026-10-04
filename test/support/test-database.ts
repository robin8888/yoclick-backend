import { Client } from 'pg';

const REQUIRED_TEST_DATABASE_SUFFIX = '_test';

export function readRequiredEnvironmentVariable(variableName: string): string {
  const value = process.env[variableName];
  if (!value) throw new Error(`${variableName} is not set. Fill it in .env (see .env.example).`);
  return value;
}

/**
 * Salvaguarda: los tests vacían tablas. Si TEST_*_URL apuntara por error a la base
 * de desarrollo o de producción, se perderían datos reales.
 */
export function assertIsTestDatabase(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.replace('/', '');
  if (!databaseName.endsWith(REQUIRED_TEST_DATABASE_SUFFIX)) {
    throw new Error(`Refusing to run tests against "${databaseName}": name must end in _test.`);
  }
}

/** TRUNCATE no pasa por RLS, así que sirve para dejar la base limpia entre pruebas. */
export async function resetTestDatabase(): Promise<void> {
  const migrationUrl = readRequiredEnvironmentVariable('TEST_MIGRATION_DATABASE_URL');
  assertIsTestDatabase(migrationUrl);
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE TABLE "idempotency_keys", "memberships", "centers", "users" RESTART IDENTITY CASCADE',
    );
  } finally {
    await client.end();
  }
}
