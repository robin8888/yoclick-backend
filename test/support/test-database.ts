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
    // Los planes son una tabla global que ningún TRUNCATE de arriba toca: un test que cambie un precio
    // dejaría el cambio para el siguiente. Se devuelven a los importes de la migración.
    // La tabla tiene seguridad por filas forzada: solo deja cambiarla en el contexto de plataforma.
    await client.query("select set_config('app.platform_role', 'admin', false)");
    await client.query(`
      update "platform_plans" as plan
      set "monthly_price_cents" = defaults.monthly, "annual_monthly_price_cents" = defaults.annual,
          "setup_fee_cents" = defaults.setup
      from (values ('basic', 3900, 3200, 0), ('pro', 7900, 6500, 0), ('premium', 14900, 12400, 29000))
        as defaults(id, monthly, annual, setup)
      where plan."id" = defaults.id`);
    await client.query(`
      update "platform_plans"
      set "max_clients" = case "id" when 'basic' then 150 when 'pro' then 500 else null end`);
    // Los ids de Stripe de los planes tampoco deben pasar de un test al siguiente.
    await client.query(`
      update "platform_plans" set "stripe_product_id" = null, "stripe_monthly_price_id" = null,
        "stripe_annual_price_id" = null, "stripe_setup_fee_price_id" = null, "stripe_tax_rate_id" = null`);
    await client.query('TRUNCATE TABLE "platform_webhook_events"');
  } finally {
    await client.end();
  }
}

/**
 * Ejecuta una sentencia como dueño de las tablas, para preparar situaciones imposibles desde la API
 * (envejecer un código, caducarlo). El dueño también está sujeto a RLS (FORCE), así que se fija la
 * persona en el contexto antes. Solo para tests, y solo contra la base `*_test`.
 */
export async function runStatementAsOwnerForUser(
  userId: string,
  statement: string,
  centerId = '',
): Promise<void> {
  const migrationUrl = readRequiredEnvironmentVariable('TEST_MIGRATION_DATABASE_URL');
  assertIsTestDatabase(migrationUrl);
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await client.query(
      "select set_config('app.user_id', $1, false), set_config('app.center_id', $2, false)",
      [userId, centerId],
    );
    const result = await client.query(statement);
    // Un UPDATE que no toca ninguna fila hace pasar o fallar un test por la razón equivocada.
    if (result.rowCount === 0) throw new Error(`Statement affected no rows: ${statement}`);
  } finally {
    await client.end();
  }
}

/** Cambia el tope de clientes de un plan, en el contexto de plataforma. `resetTestDatabase` lo deja como estaba. */
export async function setPlanClientLimitAsPlatform(planId: string, limit: number): Promise<void> {
  const migrationUrl = readRequiredEnvironmentVariable('TEST_MIGRATION_DATABASE_URL');
  assertIsTestDatabase(migrationUrl);
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await client.query("select set_config('app.platform_role', 'admin', false)");
    const result = await client.query(
      'update "platform_plans" set "max_clients" = $1 where "id" = $2',
      [limit, planId],
    );
    if (result.rowCount === 0) throw new Error(`There is no plan ${planId}`);
  } finally {
    await client.end();
  }
}

/**
 * Concede un rol de plataforma como dueño de las tablas, que es como lo hace el script de la línea de
 * comandos. La API no puede: un trigger rechaza el cambio hecho con su rol.
 */
export async function grantPlatformRoleAsOwner(
  userId: string,
  platformRole: 'admin' | 'accountant',
): Promise<void> {
  const migrationUrl = readRequiredEnvironmentVariable('TEST_MIGRATION_DATABASE_URL');
  assertIsTestDatabase(migrationUrl);
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    const result = await client.query(
      'update "users" set "platform_role" = $1::platform_role where "id" = $2',
      [platformRole, userId],
    );
    if (result.rowCount === 0) throw new Error(`No user ${userId} to grant ${platformRole}`);
  } finally {
    await client.end();
  }
}
