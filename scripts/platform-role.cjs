// Concede, quita o lista los roles de la administración de la plataforma (docs/spec/17).
// Usa la conexión de MIGRACIONES: la API no puede cambiar este campo (un trigger lo impide).
//
//   npm run platform:role -- grant tu@correo.com admin
//   npm run platform:role -- grant gestor@correo.com accountant
//   npm run platform:role -- revoke tu@correo.com
//   npm run platform:role -- list
const { Client } = require('pg');
require('dotenv').config({ quiet: true });

const ROLES = ['admin', 'accountant'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readArguments() {
  const [command, email, role] = process.argv.slice(2);
  if (command === 'list') return { command };
  if (command === 'revoke' && email) return { command, email };
  if (command === 'grant' && email && ROLES.includes(role)) return { command, email, role };
  return fail(
    'Uso:\n  platform-role grant <correo> <admin|accountant>\n  platform-role revoke <correo>\n  platform-role list',
  );
}

async function setRole(client, email, role) {
  const result = await client.query(
    'update "users" set "platform_role" = $1::platform_role where "email" = $2 and "deleted_at" is null returning "email", "platform_role"',
    [role, email],
  );
  if (result.rowCount === 0) fail(`No hay ninguna cuenta con el correo ${email}.`);
  console.log(`${result.rows[0].email}: rol de plataforma = ${result.rows[0].platform_role}`);
}

async function main() {
  const request = readArguments();
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) fail('Falta MIGRATION_DATABASE_URL en el .env (rol de migraciones).');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (request.command === 'list') {
      const result = await client.query(
        `select "email", "platform_role" from "users" where "platform_role" <> 'none' order by "email"`,
      );
      if (result.rowCount === 0) console.log('Nadie tiene rol de plataforma.');
      for (const row of result.rows) console.log(`${row.email}: ${row.platform_role}`);
      return;
    }
    await setRole(client, request.email, request.command === 'grant' ? request.role : 'none');
  } finally {
    await client.end();
  }
}

main().catch((error) => fail(error.message));
