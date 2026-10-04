import { config as loadDotenv } from 'dotenv';
import { assertIsTestDatabase, readRequiredEnvironmentVariable } from './support/test-database';

// Los tests no deben ensuciar la salida ni tocar la base de desarrollo.
loadDotenv({ quiet: true });

const testDatabaseUrl = readRequiredEnvironmentVariable('TEST_DATABASE_URL');
assertIsTestDatabase(testDatabaseUrl);

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
process.env['DATABASE_URL'] = testDatabaseUrl;
