import { randomBytes } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { generateBase64Ed25519KeyPair } from './support/generate-test-key-pair';
import { assertIsTestDatabase, readRequiredEnvironmentVariable } from './support/test-database';

const TEST_PEPPER_BYTES = 32;

// Los tests no deben ensuciar la salida ni tocar la base de desarrollo.
loadDotenv({ quiet: true });

const testDatabaseUrl = readRequiredEnvironmentVariable('TEST_DATABASE_URL');
assertIsTestDatabase(testDatabaseUrl);

// Claves efímeras de cada ejecución: los tests nunca usan los secretos del .env de desarrollo.
const testKeyPair = generateBase64Ed25519KeyPair();

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
process.env['DATABASE_URL'] = testDatabaseUrl;
process.env['JWT_ACCESS_PRIVATE_KEY_BASE64'] = testKeyPair.privateKeyBase64;
process.env['JWT_ACCESS_PUBLIC_KEY_BASE64'] = testKeyPair.publicKeyBase64;
process.env['JWT_KEY_ID'] = 'test-key';
process.env['AUTH_CODE_PEPPER_BASE64'] = randomBytes(TEST_PEPPER_BYTES).toString('base64');
process.env['MFA_ENCRYPTION_KEY_BASE64'] = randomBytes(TEST_PEPPER_BYTES).toString('base64');
// Sin red en los tests: la comprobación de contraseñas filtradas se sustituye por un doble.
process.env['PASSWORD_BREACH_CHECK'] = 'disabled';
process.env['EMAIL_PROVIDER'] = 'console';
process.env['PUSH_PROVIDER'] = 'console';
process.env['ALLOW_DISPOSABLE_EMAILS'] = 'true';
// Los tests de integración hacen muchos inicios de sesión seguidos: el límite por IP los frenaría.
// Solo el test de límites lo activa, sustituyendo el proveedor de ajustes.
process.env['RATE_LIMITING'] = 'disabled';
