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
// Sin red en los tests: los cobros usan la pasarela falsa aunque el .env apunte a Stripe.
process.env['PAYMENT_PROVIDER'] = 'fake';
// Los tests llaman al barrido de la lista de espera a mano.
process.env['WAITLIST_SWEEP_INTERVAL_SECONDS'] = '0';
// Y el inicio automático de citas.
process.env['AUTO_START_INTERVAL_SECONDS'] = '0';
// El contestador IA usa el proveedor falso y el borrado de transcripciones se lanza a mano.
process.env['VOICE_PROVIDER'] = 'fake';
process.env['VOICE_TRANSCRIPT_SWEEP_INTERVAL_SECONDS'] = '0';
// Y el reintento de los excesos de minutos pendientes de comunicar a Stripe.
process.env['VOICE_OVERAGE_REPORT_INTERVAL_SECONDS'] = '0';
// Los tests nunca llaman a Geoapify: el proveedor se sustituye por un doble.
process.env['GEOAPIFY_API_KEY'] = 'test-geoapify-key';
