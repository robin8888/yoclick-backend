import { config as loadDotenv } from 'dotenv';
import { generateBase64Ed25519KeyPair } from './support/generate-test-key-pair';
import { assertIsTestDatabase, readRequiredEnvironmentVariable } from './support/test-database';

// Los tests no deben ensuciar la salida ni tocar la base de desarrollo.
loadDotenv({ quiet: true });

const testDatabaseUrl = readRequiredEnvironmentVariable('TEST_DATABASE_URL');
assertIsTestDatabase(testDatabaseUrl);

// Claves efímeras de cada ejecución: los tests nunca usan las claves del .env de desarrollo.
const testKeyPair = generateBase64Ed25519KeyPair();

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
process.env['DATABASE_URL'] = testDatabaseUrl;
process.env['JWT_ACCESS_PRIVATE_KEY_BASE64'] = testKeyPair.privateKeyBase64;
process.env['JWT_ACCESS_PUBLIC_KEY_BASE64'] = testKeyPair.publicKeyBase64;
process.env['JWT_KEY_ID'] = 'test-key';
