import { generateKeyPairSync } from 'node:crypto';

export interface Base64KeyPair {
  readonly privateKeyBase64: string;
  readonly publicKeyBase64: string;
}

/** Par Ed25519 en PEM codificado en base64, el formato que esperan las variables de entorno. */
export function generateBase64Ed25519KeyPair(): Base64KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const toBase64 = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');
  return {
    privateKeyBase64: toBase64(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    publicKeyBase64: toBase64(publicKey.export({ type: 'spki', format: 'pem' })),
  };
}
