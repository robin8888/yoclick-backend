// Genera un par de claves Ed25519 para firmar los tokens de acceso EN DESARROLLO y las añade a .env.
// No toca nada que ya exista en .env: si las variables ya están, no hace nada.
// Producción usa claves distintas, generadas y guardadas en el gestor de secretos del proveedor.
const { generateKeyPairSync } = require('node:crypto');
const { existsSync, readFileSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');

const ENV_PATH = join(__dirname, '..', '.env');
const PRIVATE_KEY_VARIABLE = 'JWT_ACCESS_PRIVATE_KEY_BASE64';

if (!existsSync(ENV_PATH)) {
  console.error('No existe .env. Copia .env.example a .env primero.');
  process.exit(1);
}

if (readFileSync(ENV_PATH, 'utf8').includes(`${PRIVATE_KEY_VARIABLE}=`)) {
  console.log('.env ya tiene las claves JWT. No se cambia nada.');
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const toBase64 = (pem) => Buffer.from(pem).toString('base64');

appendFileSync(
  ENV_PATH,
  [
    '',
    '# --- Claves de los tokens de acceso (solo desarrollo; generadas por npm run keys:generate) ---',
    `${PRIVATE_KEY_VARIABLE}=${toBase64(privateKey.export({ type: 'pkcs8', format: 'pem' }))}`,
    `JWT_ACCESS_PUBLIC_KEY_BASE64=${toBase64(publicKey.export({ type: 'spki', format: 'pem' }))}`,
    'JWT_KEY_ID=dev-1',
    '',
  ].join('\n'),
);
console.log('Claves JWT de desarrollo añadidas a .env.');
