// Completa .env con los secretos y ajustes de DESARROLLO que falten: claves de los tokens de acceso,
// pepper de los códigos de verificación y permiso de correos de prueba (yopmail).
// Nunca modifica ni muestra lo que ya existe en .env: solo añade variables ausentes.
// Producción usa valores distintos, generados y guardados en el gestor de secretos del proveedor.
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const { existsSync, readFileSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');

const ENV_PATH = join(__dirname, '..', '.env');
const PEPPER_BYTES = 32;

if (!existsSync(ENV_PATH)) {
  console.error('No existe .env. Copia .env.example a .env primero.');
  process.exit(1);
}

const currentEnvironment = readFileSync(ENV_PATH, 'utf8');
const isMissing = (variableName) =>
  !new RegExp(`^${variableName}=.+`, 'm').test(currentEnvironment);
const toBase64 = (value) => Buffer.from(value).toString('base64');

const linesToAppend = [];

if (isMissing('JWT_ACCESS_PRIVATE_KEY_BASE64') || isMissing('JWT_ACCESS_PUBLIC_KEY_BASE64')) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  linesToAppend.push(
    '# Claves de los tokens de acceso (Ed25519, solo desarrollo)',
    `JWT_ACCESS_PRIVATE_KEY_BASE64=${toBase64(privateKey.export({ type: 'pkcs8', format: 'pem' }))}`,
    `JWT_ACCESS_PUBLIC_KEY_BASE64=${toBase64(publicKey.export({ type: 'spki', format: 'pem' }))}`,
  );
}
if (isMissing('JWT_KEY_ID')) linesToAppend.push('JWT_KEY_ID=dev-1');

if (isMissing('AUTH_CODE_PEPPER_BASE64')) {
  linesToAppend.push(
    '# Pepper con el que se firman los códigos de 6 dígitos (solo desarrollo)',
    `AUTH_CODE_PEPPER_BASE64=${toBase64(randomBytes(PEPPER_BYTES))}`,
  );
}

if (isMissing('MFA_ENCRYPTION_KEY_BASE64')) {
  linesToAppend.push(
    '# Clave AES-256 que cifra los secretos del doble factor (solo desarrollo)',
    `MFA_ENCRYPTION_KEY_BASE64=${toBase64(randomBytes(PEPPER_BYTES))}`,
  );
}

if (isMissing('ALLOW_DISPOSABLE_EMAILS')) {
  linesToAppend.push(
    '# Permite correos de usar y tirar (yopmail) para probar. En producción debe estar apagado.',
    'ALLOW_DISPOSABLE_EMAILS=true',
  );
}

if (linesToAppend.length === 0) {
  console.log('.env ya tiene todo lo necesario. No se cambia nada.');
} else {
  appendFileSync(ENV_PATH, `\n${linesToAppend.join('\n')}\n`);
  console.log(
    `Añadidas ${String(linesToAppend.filter((line) => !line.startsWith('#')).length)} variables a .env.`,
  );
}
