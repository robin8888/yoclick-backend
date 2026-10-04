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
      'TRUNCATE TABLE "idempotency_keys", "verification_codes", "consents", "memberships", "centers", "users" RESTART IDENTITY CASCADE',
    );
  } finally {
    await client.end();
  }
}

/**
 * Ejecuta una sentencia como dueño de las tablas, para preparar situaciones imposibles desde la API
 * (envejecer un código, caducarlo). El dueño también está sujeto a RLS (FORCE), así que se fija la
 * persona en el contexto antes. Solo para tests, y solo contra la base `*_test`.
 */
export async function runStatementAsOwnerForUser(userId: string, statement: string): Promise<void> {
  const migrationUrl = readRequiredEnvironmentVariable('TEST_MIGRATION_DATABASE_URL');
  assertIsTestDatabase(migrationUrl);
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await client.query("select set_config('app.user_id', $1, false)", [userId]);
    const result = await client.query(statement);
    // Un UPDATE que no toca ninguna fila hace pasar o fallar un test por la razón equivocada.
    if (result.rowCount === 0) throw new Error(`Statement affected no rows: ${statement}`);
  } finally {
    await client.end();
  }
}
