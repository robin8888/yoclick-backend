import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI (migrate, generate) usa el rol dueño de las tablas (yoclick_migrator).
 * La API en ejecución NO lee esta variable: usa DATABASE_URL con yoclick_app (SEC-63).
 *
 * `generate` no necesita base de datos, por eso no se exige la variable aquí:
 * si falta, los comandos de migración fallan por su cuenta con un mensaje claro.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['MIGRATION_DATABASE_URL'] ?? '' },
});
